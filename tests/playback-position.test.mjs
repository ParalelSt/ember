/** Where a song starts when you change songs.
 *
 *      node tests/playback-position.test.mjs   # or: npm run test:position
 *
 *  The bug this guards: picking a new song started it at the PREVIOUS song's
 *  position. The persisted "resume where you left off" position belongs to one
 *  specific track, and was being applied to whatever loaded next.
 *
 *  Needs the sandbox from tests/README.md (PB 8091, app 3010, MUSIC_DIR set)
 *  and playwright-core. Set CHROME_PATH to pick a browser. */
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

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3010';
const PASSWORD = 'BugTest2026!';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache — set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found — set CHROME_PATH');
}

function makeWav(seconds, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(2000 * Math.sin((2 * Math.PI * 220 * i) / sampleRate)), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const email = `pos-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Position Tester', verified: true }) });
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

// Two long songs, so neither can end and auto-advance mid-test. Deliberately
// DIFFERENT lengths: a new song keeping the previous song's duration is the
// native-app bug this also guards.
const stamp = Date.now();
const songs = [`Position A ${stamp}`, `Position B ${stamp}`];
const LENGTHS = { [songs[0]]: 300, [songs[1]]: 180 };
for (const title of songs) {
  const seconds = LENGTHS[title];
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makeWav(seconds))], { type: 'audio/wav' }), 'song.wav');
  form.append('title', title);
  form.append('artist', 'Position Tester');
  form.append('durationSec', String(seconds));
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${cookie}` } });
  if (!res.ok) throw new Error(`could not seed "${title}": ${res.status} ${(await res.text()).slice(0, 120)}`);
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** The player store is the app's own source of truth for the playhead. */
const playerState = (key) => page.evaluate((k) => {
  try {
    return JSON.parse(localStorage.getItem('ember.player.v1') ?? '{}')?.state?.[k] ?? null;
  } catch { return null; }
}, key);
const position = () => playerState('position');
/** `duration` is deliberately not persisted, so read what the player bar
 *  actually shows the user: the last m:ss label on the seek row. */
const duration = () => page.evaluate(() => {
  const labels = [...document.querySelectorAll('span.tabular-nums')]
    .map((el) => el.textContent?.trim() ?? '')
    .filter((t) => /^\d+:\d{2}$/.test(t));
  const last = labels.at(-1);
  if (!last) return null;
  const [m, sec] = last.split(':').map(Number);
  return m * 60 + sec;
});

async function play(title) {
  await page.getByText(title).first().click({ clickCount: 2 });
  await page.waitForTimeout(2500);
}

await page.goto(`${APP_URL}/library`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /uploads/i }).click();
await page.waitForTimeout(1000);

// 1. Play A and let it run, so there is a real position to leak.
await play(songs[0]);
await page.waitForTimeout(6000);
const posA = await position();
check('A1 the first song is playing and advancing', (posA ?? 0) > 2, `${posA}s`);
const durA = await duration();
check('A2 its length is the song’s own', Math.abs((durA ?? 0) - 300) < 3, `${durA}s, expected 300s`);

// 2. Switch to B. It must start at the beginning, not at A's position.
await play(songs[1]);
const posB = await position();
check('B1 the new song starts from the beginning', posB !== null && posB < 3,
  `${posB}s (song A was at ${posA}s)`);

// 3. Its length must be ITS length, not the 300s song's.
const durB = await duration();
check('B3 the new song does not inherit the previous song’s length',
  Math.abs((durB ?? 0) - 180) < 3, `${durB}s, expected 180s (previous song was 300s)`);

// 4. And it keeps playing from there rather than jumping.
await page.waitForTimeout(5000);
const posB2 = await position();
check('B2 it plays on from there', posB2 !== null && posB2 > (posB ?? 0) && posB2 < 15, `${posB2}s`);

// 4. A reload resumes the SAME song where it was: the feature the bug came from.
const beforeReload = await position();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const afterReload = await position();
check('C1 reloading resumes the same song near where it was',
  afterReload !== null && Math.abs(afterReload - (beforeReload ?? 0)) < 8,
  `${beforeReload}s -> ${afterReload}s`);

// 5. Then switching songs after that reload still starts clean.
await page.getByRole('tab', { name: /uploads/i }).click();
await page.waitForTimeout(1000);
await play(songs[0]);
const posAfter = await position();
check('C2 switching songs after a reload still starts from the beginning',
  posAfter !== null && posAfter < 3, `${posAfter}s (was at ${afterReload}s)`);

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
