/** Screenshots and clips on the real Report a bug and Send a request
 *  dialogs: attach a generated PNG and a short generated video, check the
 *  thumbnails and the running total, send, and check what reached "Discord".
 *
 *      node tests/attachments-ui.test.mjs     # or: npm run test:attachments-ui
 *
 *  Starts its own Discord sink on :8099 (ATTACH_SINK_PORT) that parses each
 *  multipart body: the app under test must be started with
 *  DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:8099/bug,
 *  DISCORD_FEATURE_WEBHOOK_URL=http://127.0.0.1:8099/feature and
 *  DISCORD_FIX_WEBHOOK_URL=http://127.0.0.1:8099/fix (the sandbox's
 *  start-app.sh does when started as SINK=1 ./start-app.sh; plain
 *  ./start-app.sh sends to the real Discord). Makes the two files with ffmpeg (FFMPEG_BIN, else
 *  ffmpeg on PATH). Signs in as a throwaway @ember.test user made through
 *  the PocketBase admin API, deleted at the end. SHOT_DIR keeps
 *  screenshots. Needs the sandbox from tests/README.md. */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const SINK_PORT = Number(process.env.ATTACH_SINK_PORT ?? 8099);
const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg';
const SHOTS = process.env.SHOT_DIR ?? '';
const PASSWORD = 'AttachTest2026!';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache: set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found: set CHROME_PATH');
}

// --- The two files ----------------------------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-attach-'));
const PNG = path.join(TMP, 'player screenshot.png');
const CLIP = path.join(TMP, 'skip-bug.webm');
try {
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x200:rate=1', '-frames:v', '1', PNG]);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-t', '2',
    '-c:v', 'libvpx', '-b:v', '200k', CLIP]);
} catch (e) {
  console.error(`could not make the test files with ${FFMPEG} (set FFMPEG_BIN): ${e.message}`);
  process.exit(2);
}
const pngBytes = fs.readFileSync(PNG);
const clipBytes = fs.readFileSync(CLIP);
const expectedTotal = pngBytes.length + clipBytes.length;

// --- The Discord sink ---------------------------------------------------------
/** Every POST per path, parsed: payload_json plus each files[n] as
 *  { key, name, type, bytes }. */
const received = { bug: [], feature: [], fix: [] };
/** Paths whose next POST gets a 413, the way Discord refuses a message too
 *  big for the channel's server. */
const reject413 = new Set();
const sink = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const buf = Buffer.concat(chunks);
    const key = (req.url ?? '').replace(/^\//, '');
    const entry = { contentType: req.headers['content-type'] ?? '', payload: null, files: [] };
    try {
      if (entry.contentType.startsWith('multipart/form-data')) {
        const form = await new Request('http://sink/', { method: 'POST', headers: { 'content-type': entry.contentType }, body: buf }).formData();
        for (const [k, v] of form.entries()) {
          if (k === 'payload_json') entry.payload = JSON.parse(v);
          else if (typeof v !== 'string') entry.files.push({ key: k, name: v.name, type: v.type, bytes: Buffer.from(await v.arrayBuffer()) });
        }
      } else {
        entry.payload = JSON.parse(buf.toString('utf8'));
      }
    } catch (e) {
      entry.error = String(e);
    }
    (received[key] ??= []).push(entry);
    if (reject413.delete(key)) {
      entry.rejected = true;
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end('{"message": "Request entity too large", "code": 40005}');
      return;
    }
    res.writeHead(204);
    res.end();
  });
});
await new Promise((resolve, reject) => { sink.once('error', reject); sink.listen(SINK_PORT, '127.0.0.1', resolve); });

// --- A throwaway user ---------------------------------------------------------
async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}
const token = await adminToken();
const email = `attach-uitest-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB_URL}/api/collections/users/records`, {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Attachments UI Tester', verified: true }),
});
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const userId = (await created.json()).id;
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PASSWORD }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  : ${detail}` : ''}`); };
const waitFor = async (fn, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
};
const formatMb = (n) => `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
const formatKb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
const formatBytes = (n) => (n >= 1024 * 1024 ? formatMb(n) : formatKb(n));

/** Attach both files in the open dialog and check the thumbnails. */
async function attachAndCheck(page, dialog, label) {
  check(`${label}: the empty hint shows`, await dialog.getByText('Optional. Up to 4 images or clips, 10 MB in total.').isVisible());
  // The button opens the hidden input's file chooser, as a person would.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Attach screenshot or video' }).click(),
  ]);
  check(`${label}: the chooser takes several files`, chooser.isMultiple());
  await chooser.setFiles([PNG, CLIP]);
  await dialog.locator('[data-testid="attach-duration"]').waitFor({ timeout: 10_000 });
  const m = await dialog.evaluate((root) => {
    const thumbs = [...root.querySelectorAll('[data-testid="attach-thumb"]')];
    const img = root.querySelector('[data-testid="attach-thumb"] img');
    const video = root.querySelector('[data-testid="attach-thumb"] video');
    return {
      sizes: thumbs.map((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
      kinds: thumbs.map((t) => t.dataset.kind),
      imgLoaded: !!img && img.complete && img.naturalWidth === 320,
      videoReady: !!video && video.readyState >= 1 && video.videoWidth === 160,
      duration: root.querySelector('[data-testid="attach-duration"]')?.textContent ?? '',
      summary: root.querySelector('[data-testid="attach-summary"]')?.textContent ?? '',
      removes: [...root.querySelectorAll('button[aria-label^="Remove"]')].map((b) => b.getAttribute('aria-label')),
    };
  });
  check(`${label}: two 56px square thumbnails, image then video`, JSON.stringify(m.sizes) === '[[56,56],[56,56]]' && JSON.stringify(m.kinds) === '["image","video"]', JSON.stringify(m));
  check(`${label}: the image preview loaded`, m.imgLoaded);
  check(`${label}: the clip's first frame loaded, with its length`, m.videoReady && m.duration === '0:02', `${m.videoReady} ${m.duration}`);
  check(`${label}: the total`, m.summary === `2 of 4 files, ${formatBytes(expectedTotal)} of 10 MB`, m.summary);
  check(`${label}: a remove button per file`, JSON.stringify(m.removes) === '["Remove player screenshot.png","Remove skip-bug.webm"]', JSON.stringify(m.removes));
}

/** The two files as the sink got them, after the given index. */
function checkForwarded(label, entry, firstIndex) {
  const files = entry?.files ?? [];
  const png = files.find((f) => f.key === `files[${firstIndex}]`);
  const clip = files.find((f) => f.key === `files[${firstIndex + 1}]`);
  check(`${label}: the screenshot arrived as files[${firstIndex}], renamed safely, byte for byte`,
    png?.name === 'player_screenshot.png' && png.bytes.equals(pngBytes), `${png?.name} ${png?.bytes.length}`);
  check(`${label}: the clip arrived as files[${firstIndex + 1}], byte for byte`,
    clip?.name === 'skip-bug.webm' && clip.bytes.equals(clipBytes), `${clip?.name} ${clip?.bytes.length}`);
  check(`${label}: nothing else attached`, files.length === firstIndex + 2, files.map((f) => `${f.key}=${f.name}`).join(', '));
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${APP_URL}/settings/help`, { waitUntil: 'networkidle' });

  // --- Report a bug -----------------------------------------------------------
  await page.getByRole('button', { name: /report a bug/i }).first().click();
  const bug = page.getByRole('dialog').filter({ hasText: 'Report a bug' });
  await bug.waitFor();
  await bug.getByPlaceholder('What happened? (optional)').fill('Skipping went silent, see the clip.');
  await attachAndCheck(page, bug, 'bug report');
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'attach-bug-dialog.png') }); }
  await bug.getByRole('button', { name: 'Send report' }).click();
  const gotBug = await waitFor(() => received.bug.length > 0, 60_000);
  check('bug report: reached the sink', gotBug);
  const bugEntry = received.bug.at(-1);
  check('bug report: one multipart message', bugEntry?.contentType.startsWith('multipart/form-data') && !bugEntry.error, bugEntry?.error ?? bugEntry?.contentType);
  check('bug report: the embed carries the note', bugEntry?.payload?.embeds?.[0]?.description === 'Skipping went silent, see the clip.');
  check('bug report: report.json is files[0]', bugEntry?.files[0]?.key === 'files[0]' && bugEntry.files[0].name === 'report.json');
  checkForwarded('bug report', bugEntry, 1);

  // Close whatever is left (the triage view when the sandbox has a key).
  await page.keyboard.press('Escape');
  await bug.waitFor({ state: 'hidden' }).catch(() => {});

  // --- Send a request (Fix) -------------------------------------------------
  await page.getByRole('button', { name: /^send a request$/i }).click();
  const req = page.getByRole('dialog').filter({ hasText: 'Send a request' });
  await req.waitFor();
  await req.getByRole('tab', { name: /^fix$/i }).click();
  const fixName = `Attach fix ${Date.now()}`;
  await req.getByPlaceholder(/What needs fixing/).fill(fixName);
  await req.getByPlaceholder(/What happens now and what you'd expect instead/).fill('Here is what it looks like.');
  await attachAndCheck(page, req, 'fix request');

  // Remove and re-add the clip: the remove button works in the real dialog.
  await req.getByRole('button', { name: 'Remove skip-bug.webm' }).click();
  const afterRemove = await req.locator('[data-testid="attach-thumb"]').count();
  check('fix request: remove takes the clip out', afterRemove === 1, `${afterRemove}`);
  await req.locator('[data-testid="attachment-input"]').setInputFiles([CLIP]);
  await req.locator('[data-testid="attach-duration"]').waitFor({ timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'attach-request-dialog.png') });

  await req.getByRole('button', { name: /^send$/i }).click();
  const gotFix = await waitFor(() => received.fix.length > 0);
  check('fix request: reached the fix sink', gotFix);
  const fixEntry = received.fix.at(-1);
  check('fix request: one multipart message', fixEntry?.contentType.startsWith('multipart/form-data') && !fixEntry.error, fixEntry?.error ?? fixEntry?.contentType);
  check('fix request: the embed carries the name', fixEntry?.payload?.embeds?.[0]?.title === `Fix: ${fixName}`, fixEntry?.payload?.embeds?.[0]?.title);
  checkForwarded('fix request', fixEntry, 0);
  await req.waitFor({ state: 'hidden' });

  // Reopened, the dialog starts empty again.
  await page.getByRole('button', { name: /^send a request$/i }).click();
  await req.waitFor();
  check('fix request: reopened with no files', (await req.locator('[data-testid="attach-thumb"]').count()) === 0);
  await page.keyboard.press('Escape');

  // --- Send a request (New feature), refused once for size ------------------
  // Discord says 413: the route sends it again without the files and the
  // dialog says so.
  reject413.add('feature');
  // The fix request's success toast has to be gone for the check below.
  await page.getByText(/thanks, request sent/i).first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  await page.getByRole('button', { name: /^send a request$/i }).click();
  await req.waitFor();
  const featureName = `Attach feature ${Date.now()}`;
  await req.getByPlaceholder('Short name, e.g. Sleep timer').fill(featureName);
  await req.getByPlaceholder(/What should it do, and when would you use it/).fill('With a screenshot Discord will refuse.');
  await req.locator('[data-testid="attachment-input"]').setInputFiles([PNG, CLIP]);
  await req.locator('[data-testid="attach-duration"]').waitFor({ timeout: 10_000 });
  await req.getByRole('button', { name: /^send$/i }).click();
  const toastShown = await page.getByText('Sent, but the attachments were too big for Discord').first()
    .waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check('413 once: the dialog says the attachments were left out', toastShown);
  check('413 once: no plain success toast', (await page.getByText(/thanks, request sent/i).count()) === 0);
  const [refused, resent] = received.feature;
  check('413 once: two posts, the first with the files', received.feature.length === 2 && refused.rejected && refused.files.length === 2,
    `${received.feature.length} ${refused?.files.length}`);
  const resentFields = resent?.payload?.embeds?.[0]?.fields ?? [];
  check('413 once: the resend has no files and says what was left out',
    resent?.files.length === 0 && resent.payload.embeds[0].title === `New feature: ${featureName}` &&
      resentFields.some((f) => f.name === 'Attachments' && f.value === `2 files, ${formatBytes(expectedTotal)}, too big for Discord, not included`),
    JSON.stringify(resentFields));
  await req.waitFor({ state: 'hidden' });
  received.feature.length = 0;

  // --- Straight at the route: the size limits through proxy.ts ---------------
  // Exactly 10 MB of files is allowed, and with the JSON and the multipart
  // framing the body is over Next's default 10 MB proxy buffer: without the
  // raised proxyClientMaxBodySize it would arrive cut off and fail to parse.
  const MB = 1024 * 1024;
  const post = (files) => {
    const form = new FormData();
    form.append('payload', JSON.stringify({ kind: 'feature', name: 'Limit check', main: 'Ten megabytes of files.' }));
    files.forEach(([name, bytes]) => form.append('attachments', new Blob([bytes], { type: 'image/png' }), name));
    return fetch(`${APP_URL}/api/requests`, { method: 'POST', headers: { cookie: `pb_auth=${cookie}` }, body: form });
  };
  const half = Buffer.alloc(5 * MB, 7);
  const full = await post([['a.png', half], ['b.png', half]]);
  const gotFeature = await waitFor(() => received.feature.length > 0);
  const big = received.feature.at(-1);
  check('10 MB of files: accepted', full.status === 200, `${full.status} ${await full.text()}`);
  check('10 MB of files: both reached Discord whole',
    gotFeature && big.files.length === 2 && big.files.every((f) => f.bytes.length === 5 * MB),
    (big?.files ?? []).map((f) => `${f.key}=${f.name}:${f.bytes.length}`).join(', '));
  const over = await post([['a.png', half], ['b.png', Buffer.alloc(5 * MB + 1024, 7)]]);
  const overBody = await over.json().catch(() => ({}));
  check('over 10 MB: 400 with the dialog sentence', over.status === 400 && overBody.error === 'Files are 10 MB. Discord takes 10 MB per message: trim the clip or send fewer files.', `${over.status} ${JSON.stringify(overBody)}`);
  check('over 10 MB: nothing more reached Discord', received.feature.length === 1, `${received.feature.length}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  sink.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  await fetch(`${PB_URL}/api/collections/users/records/${userId}`, { method: 'DELETE', headers: { Authorization: token } }).catch(() => {});
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
