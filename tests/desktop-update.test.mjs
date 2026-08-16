/** End-to-end test for the desktop auto-update feed.
 *
 *      node tests/desktop-update.test.mjs      # or: npm run test:update
 *
 *  Stands up a FAKE GitHub API, so it needs no token, no network and touches
 *  no real release. Start the sandbox app with:
 *
 *      GITHUB_RELEASES_TOKEN=test-token \
 *      GITHUB_API_BASE=http://127.0.0.1:4321 \
 *      GITHUB_RELEASES_REPO=ParalelSt/ember \
 *      UPDATE_CACHE_MS=0 npx next start -p 3007
 *
 *  The contract that matters: 204 means "up to date", and EVERY failure mode
 *  degrades to 204 rather than an error, because a broken update check must
 *  never interrupt someone playing music. */
import http from 'node:http';

const APP = process.env.UPDATE_APP_URL ?? 'http://127.0.0.1:3007';
const PORT = Number(process.env.FAKE_GITHUB_PORT ?? 4321);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ── fake GitHub ───────────────────────────────────────────────────────────
const INSTALLER = Buffer.from('MZ fake installer bytes');
const SIGNATURE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZwpSV1FBQUFBQQo=';

let mode = 'ok';
const seen = [];

const RELEASES = () => [
  {
    tag_name: 'v0.3.0',
    name: 'Ember v0.3.0',
    body: 'Notes for 0.3.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-16T10:00:00Z',
    assets: [
      { id: 101, name: 'Ember-v0.3.0-macos-arm64.dmg', size: 10 },
      { id: 102, name: 'Ember-v0.3.0-macos-arm64.app.tar.gz', size: 10 },
      { id: 103, name: 'Ember-v0.3.0-macos-arm64.app.tar.gz.sig', size: 10 },
      { id: 104, name: 'Ember-v0.3.0-windows-x64-setup.exe', size: 10 },
      { id: 105, name: 'Ember-v0.3.0-windows-x64-setup.exe.sig', size: 10 },
      { id: 106, name: 'Ember-v0.3.0-linux-x86_64.AppImage', size: 10 },
      { id: 107, name: 'Ember-v0.3.0-linux-x86_64.AppImage.sig', size: 10 },
    ],
  },
];

const github = http.createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization ?? null });
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.url.startsWith('/repos/') && req.url.includes('/releases?')) {
    if (mode === 'down') return json(500, { message: 'boom' });
    if (mode === 'draft-only') {
      return json(200, [{ ...RELEASES()[0], draft: true }]);
    }
    if (mode === 'no-sig') {
      const r = RELEASES()[0];
      return json(200, [{ ...r, assets: r.assets.filter((a) => !a.name.endsWith('.sig')) }]);
    }
    return json(200, RELEASES());
  }

  if (/\/releases\/assets\/\d+$/.test(req.url)) {
    const id = Number(req.url.split('/').pop());
    if ([103, 105, 107].includes(id)) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(SIGNATURE);
    }
    if ([101, 102, 104, 106].includes(id)) {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(INSTALLER.length),
      });
      return res.end(INSTALLER);
    }
    return json(404, { message: 'no such asset' });
  }

  json(404, { message: 'unexpected path' });
});
await new Promise((r) => github.listen(PORT, '127.0.0.1', r));

const feed = (target, arch, current) =>
  fetch(`${APP}/api/desktop/update/${target}/${arch}/${current}`, { redirect: 'manual' });

// ── an update is available ────────────────────────────────────────────────
mode = 'ok';
const mac = await feed('darwin', 'aarch64', '0.2.0');
const macBody = mac.status === 200 ? await mac.json() : null;
check('A1 offers an update to an older client', mac.status === 200, `status ${mac.status}`);
check('A2 reports the release version', macBody?.version === '0.3.0', macBody?.version);
check('A3 macOS updates from the .app.tar.gz, not the .dmg',
  macBody?.url?.endsWith('/api/desktop/asset/102'), macBody?.url);
check('A4 carries the signature Tauri verifies', macBody?.signature === SIGNATURE);
check('A5 download points at OUR server, never GitHub directly',
  macBody?.url?.includes('/api/desktop/asset/') && !macBody.url.includes('github'), macBody?.url);
check('A6 release notes included', typeof macBody?.notes === 'string' && macBody.notes.length > 0);

const win = await feed('windows', 'x86_64', '0.2.0').then((r) => r.json());
check('B1 Windows gets the NSIS installer', win.url.endsWith('/api/desktop/asset/104'), win.url);
const linux = await feed('linux', 'x86_64', '0.2.0').then((r) => r.json());
check('B2 Linux gets the AppImage', linux.url.endsWith('/api/desktop/asset/106'), linux.url);

// ── up to date ────────────────────────────────────────────────────────────
check('C1 same version → 204', (await feed('darwin', 'aarch64', '0.3.0')).status === 204);
check('C2 newer client → 204', (await feed('darwin', 'aarch64', '0.4.0')).status === 204);
check('C3 unknown platform → 204', (await feed('freebsd', 'x86_64', '0.1.0')).status === 204);

// ── failure modes must all degrade to "no update" ─────────────────────────
mode = 'down';
check('D1 GitHub 500 → 204, not an error', (await feed('darwin', 'aarch64', '0.1.0')).status === 204);
mode = 'draft-only';
check('D2 draft releases are ignored', (await feed('darwin', 'aarch64', '0.1.0')).status === 204);
mode = 'no-sig';
check('D3 a missing .sig blocks the update rather than shipping it unverifiable',
  (await feed('darwin', 'aarch64', '0.1.0')).status === 204);

// ── the asset proxy ───────────────────────────────────────────────────────
mode = 'ok';
const before = seen.length;
const dl = await fetch(`${APP}/api/desktop/asset/104`);
const bytes = Buffer.from(await dl.arrayBuffer());
check('E1 proxy streams the installer', dl.status === 200 && bytes.equals(INSTALLER),
  `${bytes.length} bytes`);
const tokened = seen.slice(before).filter((r) => r.auth?.includes('test-token'));
check('E2 the token is attached server-side', tokened.length > 0);
check('E3 bad asset id rejected', (await fetch(`${APP}/api/desktop/asset/abc`)).status === 400);
check('E4 unknown asset → 404', (await fetch(`${APP}/api/desktop/asset/999`)).status === 404);

// ── reachable without a session (the updater has none) ────────────────────
check('F1 feed needs no login', (await feed('darwin', 'aarch64', '0.2.0')).status === 200);

github.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
process.exit(failed.length ? 1 : 0);
