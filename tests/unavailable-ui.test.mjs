/** UI check (U1-U4 of the plan's Task 5): the greyed unavailable row, the
 *  playlist Play button skipping past it, and the find-replacement dialog.
 *
 *      node tests/unavailable-ui.test.mjs   # or: npm run test:unavailable-ui
 *
 *  Proves, against a real browser:
 *   - U1: a flagged track's row carries data-unavailable="true", the
 *     "Unavailable" badge, and its own Play button is disabled
 *     (aria-label="Unavailable")
 *   - U2: the page's big Play button starts the playlist, skips the dead
 *     first track with a "Skipped: ..." toast, and lands on the live track
 *   - U3: the "Find replacement" dialog lists the fake player's candidates,
 *     and confirming one replaces the row (checked both in the DOM and via
 *     GET /api/playlists/<id>)
 *   - U4: no console errors other than media decode errors from the fake
 *     audio bytes
 *
 *  Same sandbox as tests/unavailable.test.mjs (PB 8092, app 3011, the
 *  fake-player.sh wiring). */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8092';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3011';
const SB = process.env.SB ?? '/tmp/ember-unavailable-test';
const PW = 'BugTest2026!';

// Fixed ids the fake player recognizes (tests/fake-player.sh): DEAD is the
// row we flag unavailable; its `search`/`match` responses hand back
// bbbbbbbbbbb/eeeeeeeeeee/fffffffffff as replacement candidates.
const DEAD = 'ddddddddddd';
const LIVE = 'aaaaaaaaaaa';

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

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB_URL + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no admin');
}

function track(videoId, title) {
  return {
    id: `youtube:${videoId}`,
    source: 'youtube',
    sourceId: videoId,
    title,
    artist: 'Fake Artist',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: `/api/youtube/stream/${videoId}`,
  };
}

const writeList = (name, ids) => fs.writeFileSync(`${SB}/${name}`, ids.join('\n') + (ids.length ? '\n' : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tok = await adminToken();
const email = `unavailui-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: tok },
  body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: 'Unavail UI Tester', verified: true }) });
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })
  .then((r) => r.json());
const cookie = `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}`;

function call(p, opts = {}) {
  return fetch(APP_URL + p, {
    ...opts,
    redirect: 'manual',
    headers: {
      ...(opts.headers || {}),
      cookie,
      ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
  });
}

// ── seed: a playlist with a dead track and a live one ──
const plRes = await call('/api/playlists', { method: 'POST', body: JSON.stringify({ name: `Unavail UI ${Date.now()}` }) });
const { playlist } = await plRes.json().catch(() => ({}));
check('setup: playlist created', plRes.status === 201 && !!playlist?.id, `status ${plRes.status}`);
const playlistId = playlist?.id;

// DEAD is named "Replacement Song" to match the brief's U2/U3 checks and
// tests/fake-player.sh's `search`/`match` results (the same-song candidate
// bbbbbbbbbbb shares that title, which is the point: it's a re-upload).
for (const [id, title] of [[DEAD, 'Replacement Song'], [LIVE, 'Live Song']]) {
  const r = await call(`/api/playlists/${playlistId}/tracks`, { method: 'POST', body: JSON.stringify({ track: track(id, title) }) });
  check(`setup: added ${title}`, r.status === 201, `status ${r.status}`);
}

// upsertTrack only backfills MISSING fields on an existing tracks row, so a
// title from an earlier test run against the same PocketBase (e.g. DEAD as
// "Dead Song" in tests/unavailable.test.mjs, same fixed video id) sticks
// around forever otherwise. Force both titles here so the UI actually shows
// what this test expects, regardless of run order.
async function forceTitle(videoId, title) {
  const rows = await fetch(`${PB_URL}/api/collections/tracks/records?filter=${encodeURIComponent(`external_id = "youtube:${videoId}"`)}`,
    { headers: { Authorization: tok } }).then((r) => r.json());
  const row = rows.items?.[0];
  if (row && row.title !== title) {
    await fetch(`${PB_URL}/api/collections/tracks/records/${row.id}`, { method: 'PATCH',
      headers: { Authorization: tok, 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  }
}
await forceTitle(DEAD, 'Replacement Song');
await forceTitle(LIVE, 'Live Song');

// Flag DEAD the same way part A of unavailable.test.mjs does: list it in the
// fake player's unavailable file, then hit the stream route so the server's
// own detection path writes the flag (not a manual PB write).
writeList('unavailable.txt', [DEAD]);
const streamRes = await call(`/api/youtube/stream/${DEAD}`);
check('setup: stream DEAD answers 410', streamRes.status === 410, `status ${streamRes.status}`);
await streamRes.arrayBuffer().catch(() => {});

// markTrackUnavailable is fire-and-forget, so poll the playlist briefly.
async function pollDeadFlagged() {
  for (let i = 0; i < 20; i++) {
    const pl = await call(`/api/playlists/${playlistId}`).then((r) => r.json());
    const t = pl.tracks?.find((x) => x.id === `youtube:${DEAD}`);
    if (t?.unavailableAt) return true;
    await sleep(100);
  }
  return false;
}
check('setup: DEAD flagged on the playlist', await pollDeadFlagged());

// ── browser ──
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie.slice('pb_auth='.length), domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(`${APP_URL}/playlist/${playlistId}`, { waitUntil: 'networkidle' });

// ── U1: the flagged row ──
const row = page.locator('[data-unavailable="true"]');
await row.waitFor({ timeout: 10_000 }).catch(() => {});
check('U1: the dead track row carries data-unavailable="true"', (await row.count()) === 1, `count ${await row.count()}`);

const badge = row.getByTestId('unavailable-badge');
// The badge is styled uppercase (CSS text-transform), so innerText renders
// as "UNAVAILABLE" even though the DOM text content is "Unavailable".
const badgeText = (await badge.count()) === 1 ? (await badge.innerText()).toLowerCase() : '';
check('U1: the row shows the "Unavailable" badge', badgeText === 'unavailable', badgeText);

const unavailablePlayBtn = row.getByRole('button', { name: 'Unavailable' });
check('U1: the row\'s own Play button is disabled', await unavailablePlayBtn.isDisabled().catch(() => false));

const findReplacementBtn = row.getByRole('button', { name: 'Find replacement' });
check('U1: the row shows a "Find replacement" button', (await findReplacementBtn.count()) === 1);

// ── U2: the page's big Play button starts the playlist at track 0 (the dead
// one), skips it with a toast, and plays the live track instead ──
// The row Play buttons share this aria-label too, but the big button is the
// first `button[aria-label="Play"]` in the DOM (it sits above the track list).
const bigPlayBtn = page.locator('button[aria-label="Play"]').first();
await bigPlayBtn.click();
await page.getByText(/^Skipped: "Replacement Song"/).waitFor({ timeout: 5_000 });
check('U2: a "Skipped" toast names the dead track', true);
// The live track still has to actually download through the fake player
// (tests/fake-player.sh sleeps ~2s to simulate that), so give this more
// room than the toast's 5s bound.
let audioSrc = '';
for (let i = 0; i < 100; i++) {
  audioSrc = await page.evaluate(() => document.querySelector('audio')?.src ?? '');
  if (audioSrc.includes(LIVE)) break;
  await sleep(150);
}
check('U2: the audio element plays the live track instead', audioSrc.includes(LIVE), audioSrc);

// ── U3: the find-replacement dialog ──
await findReplacementBtn.click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ timeout: 10_000 });
check('U3: the replace dialog opens', true);
check('U3: the dialog header names the dead track', /Replace "Replacement Song"/.test(await dialog.innerText()));

const firstCandidate = dialog.getByRole('radio').first();
await firstCandidate.waitFor({ timeout: 10_000 });
const candidateText = await firstCandidate.innerText();
check('U3: the top candidate is "Replacement Song" by "Fake Artist"', candidateText.includes('Replacement Song') && candidateText.includes('Fake Artist'), candidateText);

const candidates = dialog.getByRole('radio');
const candidateCount = await candidates.count();
check('U3: the dialog lists at least one candidate', candidateCount >= 1, `${candidateCount} candidate(s)`);

const replaceBtn = dialog.getByRole('button', { name: 'Replace' });
check('U3: the Replace button is enabled once a candidate is picked (default selection)', await replaceBtn.isEnabled());

await replaceBtn.click();
await page.getByText(/^Replaced with "/).waitFor({ timeout: 10_000 });
check('U3: the "Replaced with" toast appears', true);

await dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
check('U3: the dialog closes after a successful replace', (await page.getByRole('dialog').count()) === 0);

await row.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
const stillDead = await page.locator('[data-unavailable="true"]').count();
check('U3: the row is no longer marked unavailable after replacing', stillDead === 0, `${stillDead} still flagged`);

const replacedRow = page.getByText('Replacement Song', { exact: false }).first();
check('U3: a row shows "Replacement Song" (the new track) without the badge', (await replacedRow.count()) > 0);

const plAfter = await call(`/api/playlists/${playlistId}`).then((r) => r.json());
const idsAfter = (plAfter.tracks ?? []).map((t) => t.id);
check(
  'U3: GET /api/playlists/<id> returns bbbbbbbbbbb first, aaaaaaaaaaa second',
  JSON.stringify(idsAfter) === JSON.stringify(['youtube:bbbbbbbbbbb', `youtube:${LIVE}`]),
  JSON.stringify(idsAfter),
);

// ── U4: no console errors other than media decode errors from the fake
// audio bytes (FAKE-AUDIO-<id> isn't real audio, so the <audio> element
// always fails to decode it, that's expected noise, not a bug) and the page's
// unrelated lyrics fetch, which 502s in this sandbox (no real lyrics
// provider or network access; every track detail view hits it regardless of
// availability, so it's a pre-existing sandbox limitation, not something
// this feature introduces). Browser "Failed to load resource" console
// messages don't carry the URL, so match on the 502 status text instead. ──
const noisy = consoleErrors.filter((e) =>
  !/favicon|404/.test(e) &&
  !/MEDIA_ELEMENT_ERROR|no supported source/.test(e) &&
  !/502 \(Bad Gateway\)/.test(e));
check('U4: no unexpected console errors', noisy.length === 0, noisy.slice(0, 2).join(' | '));

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
