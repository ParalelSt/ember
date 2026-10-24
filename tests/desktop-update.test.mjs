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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
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
  {
    tag_name: 'v0.2.0',
    name: 'Ember v0.2.0',
    body: 'Notes for 0.2.0',
    draft: false,
    prerelease: false,
    published_at: '2026-08-01T10:00:00Z',
    assets: [{ id: 201, name: 'Ember-v0.2.0-windows-x64-setup.exe', size: 10 }],
  },
];

// Per-app releases (windows-v0.4.26, android-v0.4.27) next to the last
// shared one (v0.4.25), newest first as GitHub lists them. Asset names keep
// the bare version.
const MIXED = () => [
  {
    tag_name: 'android-v0.4.27',
    name: 'Ember Android 0.4.27',
    body: 'Android only',
    draft: false,
    prerelease: false,
    published_at: '2026-10-26T10:00:00Z',
    assets: [{ id: 301, name: 'Ember-v0.4.27-android.apk', size: 10 }],
  },
  {
    tag_name: 'windows-v0.4.26',
    name: 'Ember Windows 0.4.26',
    body: 'Windows only',
    draft: false,
    prerelease: false,
    published_at: '2026-10-25T10:00:00Z',
    assets: [
      { id: 311, name: 'Ember-v0.4.26-windows-x64-setup.exe', size: 10 },
      { id: 312, name: 'Ember-v0.4.26-windows-x64-setup.exe.sig', size: 10 },
    ],
  },
  {
    tag_name: 'linux-v0.4.28',
    name: 'Ember Linux 0.4.28 (draft)',
    draft: true,
    prerelease: false,
    assets: [{ id: 331, name: 'Ember-v0.4.28-linux-x86_64.AppImage', size: 10 }],
  },
  {
    tag_name: 'v0.4.25',
    name: 'Ember v0.4.25',
    body: 'Every app',
    draft: false,
    prerelease: false,
    published_at: '2026-10-24T10:00:00Z',
    assets: [
      { id: 321, name: 'Ember-v0.4.25-windows-x64-setup.exe', size: 10 },
      { id: 322, name: 'Ember-v0.4.25-windows-x64-setup.exe.sig', size: 10 },
      { id: 323, name: 'Ember-v0.4.25-macos-arm64.app.tar.gz', size: 10 },
      { id: 324, name: 'Ember-v0.4.25-macos-arm64.app.tar.gz.sig', size: 10 },
      { id: 325, name: 'Ember-v0.4.25-linux-x86_64.AppImage', size: 10 },
      { id: 326, name: 'Ember-v0.4.25-linux-x86_64.AppImage.sig', size: 10 },
      { id: 327, name: 'Ember-v0.4.25-android.apk', size: 10 },
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
    if (mode === 'mixed') return json(200, MIXED());
    if (mode === 'no-sig') {
      const r = RELEASES()[0];
      return json(200, [{ ...r, assets: r.assets.filter((a) => !a.name.endsWith('.sig')) }]);
    }
    return json(200, RELEASES());
  }

  if (/\/releases\/assets\/\d+$/.test(req.url)) {
    const id = Number(req.url.split('/').pop());
    if ([103, 105, 107, 312, 322, 324, 326].includes(id)) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(SIGNATURE);
    }
    if ([101, 102, 104, 106, 201, 301, 311, 321, 323, 325, 327, 331].includes(id)) {
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

// Only the latest release's updater files, and GitHub is never asked for
// anything else with the host's token (security audit 2026-09-25, M3).
{
  const upstreamBefore = seen.length;
  const dmg = await fetch(`${APP}/api/desktop/asset/101`);
  check('E5 a hand-download installer (.dmg) is not proxied', dmg.status === 404, `status ${dmg.status}`);
  const old = await fetch(`${APP}/api/desktop/asset/201`);
  check('E6 an older release asset is not proxied', old.status === 404, `status ${old.status}`);
  const asked = seen.slice(upstreamBefore).filter((r) => /\/releases\/assets\/(101|201|999)$/.test(r.url));
  check('E7 GitHub was never asked for them', asked.length === 0, asked.map((r) => r.url).join(','));
  const sig = await fetch(`${APP}/api/desktop/asset/103`);
  check('E8 the update bundle .sig is still served', sig.status === 200 && (await sig.text()) === SIGNATURE, `status ${sig.status}`);
}

// ── per-app releases next to the old shared tag ───────────────────────────
mode = 'mixed';
{
  const win = await feed('windows', 'x86_64', '0.4.25');
  const winBody = win.status === 200 ? await win.json() : null;
  check('G1 a 0.4.25 Windows app (on the shared v0.4.25 tag) gets windows-v0.4.26',
    winBody?.version === '0.4.26' && winBody?.url?.endsWith('/api/desktop/asset/311'), `${win.status} ${winBody?.version} ${winBody?.url}`);
  check('G2 the Mac app sees neither the Windows nor the Android release',
    (await feed('darwin', 'aarch64', '0.4.25')).status === 204);
  check('G3 an Android-only release is invisible to the desktop apps',
    (await feed('linux', 'x86_64', '0.4.25')).status === 204);
  const older = await feed('darwin', 'aarch64', '0.4.24');
  const olderBody = older.status === 200 ? await older.json() : null;
  check('G4 an older Mac app still gets the shared v0.4.25', olderBody?.version === '0.4.25' && olderBody?.url?.endsWith('/api/desktop/asset/323'),
    `${older.status} ${olderBody?.version}`);

  const phone = await fetch(`${APP}/api/android/update?version=0.4.25`);
  const phoneBody = phone.status === 200 ? await phone.json() : null;
  check('G5 the phone gets android-v0.4.27', phoneBody?.version === '0.4.27' && phoneBody?.url === '/api/android/apk/301',
    `${phone.status} ${phoneBody?.version} ${phoneBody?.url}`);

  const gate = await fetch(`${APP}/api/app/update?platform=windows&version=0.4.25&install=nsis&arch=x86_64`).then((r) => r.json());
  check('G6 the launch gate tells Windows about 0.4.26', gate.latest === '0.4.26' && gate.update?.version === '0.4.26', JSON.stringify(gate.update));
  const macGate = await fetch(`${APP}/api/app/update?platform=macos&version=0.4.25&install=app`).then((r) => r.json());
  check('G7 the launch gate tells the Mac it is current', macGate.latest === '0.4.25' && macGate.update === null, JSON.stringify(macGate));

  const upstreamBefore = seen.length;
  check('G8 the proxy serves the Windows release bundle', (await fetch(`${APP}/api/desktop/asset/311`)).status === 200);
  check('G9 the proxy serves the shared release the Mac is still on', (await fetch(`${APP}/api/desktop/asset/323`)).status === 200);
  check('G10 the APK proxy serves the current Android APK', (await fetch(`${APP}/api/android/apk/301`)).status === 200);
  check('G11 the APK proxy refuses the shared release APK Android moved past', (await fetch(`${APP}/api/android/apk/327`)).status === 404);
  check('G12 a draft release asset is never served', (await fetch(`${APP}/api/desktop/asset/331`)).status === 404);
  const asked = seen.slice(upstreamBefore).filter((r) => /\/releases\/assets\/(327|331)$/.test(r.url));
  check('G13 GitHub was never asked for them', asked.length === 0, asked.map((r) => r.url).join(','));
}

// ── reachable without a session (the updater has none) ────────────────────
mode = 'ok';
check('F1 feed needs no login', (await feed('darwin', 'aarch64', '0.2.0')).status === 200);

github.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
process.exit(failed.length ? 1 : 0);
