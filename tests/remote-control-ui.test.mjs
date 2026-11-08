/** Controlling playback on your other devices, slices 1a and 1b
 *  (docs/plans/2026-11-08-device-remote-control.md, W8): two browser
 *  contexts signed in to one account, so two devices.
 *
 *      PB_URL=http://127.0.0.1:8088 APP_URL=http://127.0.0.1:3074 node tests/remote-control-ui.test.mjs
 *      # or: npm run test:remote-ui
 *
 *  A plays an uploaded song; B opens and, within 3 s, shows the same title
 *  with "Playing on Browser" and its seek bar moving; B's pause pauses A's
 *  audio element; B's seek to 90 s moves A; B's Next changes A's song; a
 *  tap on another song in B's library plays it on A while B keeps
 *  controlling. The moves, through the output picker: B picks "This
 *  computer" and plays A's song at A's playhead within 3 s while A pauses;
 *  B picks A's row and the music is back on A at B's playhead within 3 s.
 *  A is closed and B leaves remote mode within 40 s; a second account
 *  never sees A. Timings are printed for the latency target.
 *
 *  Needs a sandbox (`npm run sandbox -- start --port 3074`: PocketBase on
 *  8088, the app built from this tree) and playwright-core. The sandbox
 *  admin login comes from POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD
 *  or ~/.ember-tools/sandbox.env. Set CHROME_PATH to pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3074';
const PASSWORD = 'RemoteTest2026!';
const SHOTS = process.env.SHOTS_DIR ?? '';
const SONG_SEC = 180;
/** Far from where A is when B seeks (about 20 s in). */
const SEEK_TO = 90;

function sandboxLogin() {
  let email = process.env.POCKETBASE_ADMIN_EMAIL;
  let password = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!email || !password) {
    try {
      const text = fs.readFileSync(path.join(os.homedir(), '.ember-tools/sandbox.env'), 'utf8');
      for (const line of text.split('\n')) {
        const m = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
        if (m?.[1] === 'POCKETBASE_ADMIN_EMAIL') email ??= m[2];
        if (m?.[1] === 'POCKETBASE_ADMIN_PASSWORD') password ??= m[2];
      }
    } catch {}
  }
  if (!email || !password) throw new Error('no sandbox admin login: set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD');
  return { email, password };
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache, set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found, set CHROME_PATH');
}

async function adminToken() {
  const { email, password } = sandboxLogin();
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: email, password }) });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const su = await adminToken();
const run = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;
const pbHeaders = { 'content-type': 'application/json', Authorization: su };
const created = [];

/** A fresh user, signed in: id, token and the pb_auth cookie value. */
async function member(tag) {
  const email = `remote-${tag}-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST', headers: pbHeaders,
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: `Remote ${tag}`, verified: true }) });
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
  created.push(auth.record.id);
  return { id: auth.record.id, cookie: encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record })) };
}

const app = (who, p, init = {}) => fetch(`${APP_URL}${p}`, { ...init,
  headers: { 'content-type': 'application/json', cookie: `pb_auth=${who.cookie}`, ...(init.headers ?? {}) } });

function makeWav(seconds = SONG_SEC, sampleRate = 8000, freq = 440) {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * freq * i) / sampleRate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function uploadSong(who, title, freq) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makeWav(SONG_SEC, 8000, freq))], { type: 'audio/wav' }), 'song.wav');
  form.append('title', title);
  form.append('artist', 'Remote Band');
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${who.cookie}` } });
  if (!res.ok) throw new Error(`could not seed a song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).track;
}

const checks = [];
const timings = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `remote-${name}.png`) }).catch(() => {});
};

/** Polls `probe` until it is truthy or `ms` pass; the wait in ms, or null. */
async function within(ms, probe) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await probe()) return Date.now() - t0;
    await sleep(100);
  }
  return null;
}
const timed = (label, ms, target) => {
  timings.push(`${label}: ${ms === null ? 'timed out' : `${ms} ms`} (target ${target} ms)`);
  return ms;
};

// ── one account, two songs; and someone else ──────────────────────────────
const owner = await member('owner');
const outsider = await member('outsider');
const first = await uploadSong(owner, `First Remote ${run}`, 440);
const second = await uploadSong(owner, `Second Remote ${run}`, 660);

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
async function device(who, id) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  await ctx.addCookies([{ name: 'pb_auth', value: who.cookie, domain: new URL(APP_URL).hostname, path: '/' }]);
  // Each context is its own device: its own id from the first load on.
  await ctx.addInitScript((deviceId) => {
    try { if (!localStorage.getItem('ember.device.id')) localStorage.setItem('ember.device.id', deviceId); } catch {}
  }, id);
  const page = await ctx.newPage();
  return { ctx, page, id };
}

/** The page's audio element that has a song. */
const audioState = (page) => page.evaluate(() => {
  const a = [...document.querySelectorAll('audio')].find((x) => x.src);
  return a ? { paused: a.paused, time: a.currentTime, src: a.src } : null;
});
const barText = (page) => page.locator('[data-testid="player-bar-now"]').textContent({ timeout: 1000 }).catch(() => '');
const devicesLabel = (page) => page.locator('[data-testid="devices-button"]').getAttribute('aria-label', { timeout: 1000 }).catch(() => null);
const barTime = (page) => page.locator('footer[data-testid="player-bar"] .tabular-nums').first().textContent({ timeout: 1000 }).catch(() => '');
const toSec = (mmss) => {
  const m = /(\d+):(\d+)/.exec(mmss ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

let failed = false;
try {
  // ── A plays ─────────────────────────────────────────────────────────────
  const A = await device(owner, `deviceA${run.replace(/[^0-9]/g, '')}`.slice(0, 40));
  await A.page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await A.page.getByText(first.title, { exact: true }).first().click({ clickCount: 2 });
  const aPlaying = await within(15_000, async () => {
    const s = await audioState(A.page);
    return s && !s.paused && s.time > 0.5;
  });
  check('A plays the uploaded song', aPlaying !== null);
  await sleep(1500);

  // ── B opens and controls A ──────────────────────────────────────────────
  const B = await device(owner, `deviceB${run.replace(/[^0-9]/g, '')}`.slice(0, 40));
  const bOpened = Date.now();
  await B.page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'domcontentloaded' });
  const shown = await within(15_000, async () =>
    (await barText(B.page))?.includes(first.title) && (await devicesLabel(B.page)) === 'Devices: playing on Browser');
  const shownMs = shown === null ? null : Date.now() - bOpened;
  timed('B shows what A plays after opening', shownMs, 3000);
  check('B shows the same title and "Playing on Browser"', shown !== null, `${await barText(B.page)} / ${await devicesLabel(B.page)}`);
  check('... within 3 s of opening', shownMs !== null && shownMs <= 3000, `${shownMs} ms`);
  const t1 = toSec(await barTime(B.page));
  await sleep(2500);
  const t2 = toSec(await barTime(B.page));
  check("B's seek bar moves with A's playhead", t2 > t1, `${t1} s then ${t2} s`);
  const bAudio = await audioState(B.page);
  check('nothing plays on B', !bAudio || bAudio.paused, JSON.stringify(bAudio));

  // No wait here: B's first poll answers A's held beat, so A hears at once
  // that it is watched (lib/remote/cadence).

  // ── pause ───────────────────────────────────────────────────────────────
  await B.page.locator('footer[data-testid="player-bar"]').getByRole('button', { name: 'Pause', exact: true }).first().click();
  const paused = timed('pause on B to A paused', await within(10_000, async () => (await audioState(A.page))?.paused === true), 2000);
  check("B's pause pauses A's audio", paused !== null, `${paused} ms`);
  check('... within 2 s', paused !== null && paused <= 2000, `${paused} ms`);

  await shot(B.page, 'b-after-pause');
  // ── seek to 90 s ────────────────────────────────────────────────────────
  const track = B.page.locator('footer[data-testid="player-bar"] [data-slot="slider-track"]').first();
  const box = await track.boundingBox();
  if (box) await B.page.mouse.click(box.x + box.width * (SEEK_TO / SONG_SEC), box.y + box.height / 2);
  const seeked = timed('seek on B to A moved', await within(10_000, async () => {
    const s = await audioState(A.page);
    return s && Math.abs(s.time - SEEK_TO) < 6;
  }), 2000);
  check(`B's seek to ${SEEK_TO} s moves A's playhead`, seeked !== null, `A at ${(await audioState(A.page))?.time?.toFixed(1)} s`);

  await shot(B.page, 'b-after-seek');
  // ── play again, then Next ───────────────────────────────────────────────
  await B.page.locator('footer[data-testid="player-bar"]').getByRole('button', { name: 'Play', exact: true }).first().click();
  const resumed = timed('play on B to A playing', await within(10_000, async () => (await audioState(A.page))?.paused === false), 2000);
  check("B's play resumes A", resumed !== null, `${resumed} ms`);
  const srcBefore = (await audioState(A.page))?.src;
  await B.page.locator('footer[data-testid="player-bar"]').getByRole('button', { name: 'Next', exact: true }).first().click();
  const nexted = timed('next on B to A on another song', await within(10_000, async () => {
    const s = await audioState(A.page);
    return s && s.src !== srcBefore;
  }), 2000);
  check("B's Next changes A's song", nexted !== null, `${nexted} ms`);
  await sleep(2500);

  // ── a tap in B's library plays on A ────────────────────────────────────
  const aNow = (await barText(A.page)) ?? '';
  const pick = aNow.includes(first.title) ? second : first;
  await B.page.getByText(pick.title, { exact: true }).first().click({ clickCount: 2 });
  const tapped = timed('tap on B to A playing that song', await within(10_000, async () => {
    const s = await audioState(A.page);
    return (await barText(A.page))?.includes(pick.title) && s && !s.paused;
  }), 3000);
  check('a song tapped on B plays on A', tapped !== null, `${tapped} ms`);
  check('... within 3 s', tapped !== null && tapped <= 3000, `${tapped} ms`);
  const bAfter = await audioState(B.page);
  check('B stays in remote mode, nothing plays on B', (await devicesLabel(B.page)) === 'Devices: playing on Browser' && (!bAfter || bAfter.paused),
    `${await devicesLabel(B.page)} / ${JSON.stringify(bAfter)}`);

  // ── move: B picks This computer ────────────────────────────────────────
  const devicesButton = B.page.locator('[data-testid="devices-button"]');
  const pickRow = async (pattern) => {
    await devicesButton.click();
    const row = B.page.getByRole('menuitem').filter({ hasText: pattern }).first();
    await row.waitFor({ timeout: 5000 });
    await row.click();
  };
  await sleep(1500);
  const aBeforeHere = await audioState(A.page);
  const songOnA = (await barText(A.page)) ?? '';
  const movedTitle = songOnA.includes(second.title) ? second.title : first.title;
  await pickRow(/^This computer/);
  const here = timed('pick This computer to B playing', await within(10_000, async () => {
    const b = await audioState(B.page);
    return b && !b.paused && b.time > 0;
  }), 3000);
  const bHere = await audioState(B.page);
  const aAfterHere = await audioState(A.page);
  check('This computer: B plays the song here', here !== null && (await barText(B.page))?.includes(movedTitle), `${here} ms, ${await barText(B.page)}`);
  check('... within 3 s', here !== null && here <= 3000, `${here} ms`);
  check("... at A's playhead", !!bHere && !!aBeforeHere && bHere.time >= aBeforeHere.time - 1 && bHere.time <= aBeforeHere.time + 5,
    `A was at ${aBeforeHere?.time?.toFixed(1)} s, B at ${bHere?.time?.toFixed(1)} s`);
  const aPaused = await within(5000, async () => (await audioState(A.page))?.paused === true);
  check('... and A pauses', aPaused !== null, JSON.stringify(aAfterHere));
  check('B left remote mode', (await devicesLabel(B.page)) !== 'Devices: playing on Browser', `${await devicesLabel(B.page)}`);
  await sleep(4000);
  check('B stays local (no going straight back to controlling A)', (await devicesLabel(B.page)) !== 'Devices: playing on Browser'
    && (await audioState(B.page))?.paused === false);

  // ── move: B picks A's row ──────────────────────────────────────────────
  const bBeforeThere = await audioState(B.page);
  await pickRow(/^Browser/);
  const there = timed("pick A's row to A playing", await within(10_000, async () => {
    const a = await audioState(A.page);
    return a && !a.paused && (await barText(A.page))?.includes(movedTitle);
  }), 3000);
  const aThere = await audioState(A.page);
  check("A's row: the music is back on A", there !== null, `${there} ms`);
  check('... within 3 s', there !== null && there <= 3000, `${there} ms`);
  check("... at B's playhead", !!aThere && !!bBeforeThere && aThere.time >= bBeforeThere.time - 1 && aThere.time <= bBeforeThere.time + 5,
    `B was at ${bBeforeThere?.time?.toFixed(1)} s, A at ${aThere?.time?.toFixed(1)} s`);
  const bStopped = await within(5000, async () => {
    const b = await audioState(B.page);
    return !b || b.paused;
  });
  check('... B stops and controls A again', bStopped !== null && (await devicesLabel(B.page)) === 'Devices: playing on Browser', `${await devicesLabel(B.page)}`);
  const moved = await B.page.getByText('Moved to Browser').first().isVisible().catch(() => false);
  check('B says where the music went', moved);

  // ── another account never sees A ───────────────────────────────────────
  const theirs = await app(outsider, '/api/remote/state?device=outsiderdevice1').then((r) => r.json());
  check("another account's state lists none of A's devices", Array.isArray(theirs.devices) && theirs.devices.length === 0 && theirs.active === null,
    JSON.stringify(theirs).slice(0, 200));
  const O = await device(outsider, 'outsiderdevice2');
  await O.page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await sleep(3000);
  check('another account does not attach to A', (await devicesLabel(O.page)) !== 'Devices: playing on Browser', `${await devicesLabel(O.page)}`);
  await O.ctx.close();

  // ── A goes away: B leaves remote mode ──────────────────────────────────
  await A.ctx.close();
  const closedAt = Date.now();
  const left = await within(50_000, async () => (await devicesLabel(B.page)) !== 'Devices: playing on Browser');
  const leftMs = left === null ? null : Date.now() - closedAt;
  timed('A closed to B back in local mode', leftMs, 40_000);
  check('B leaves remote mode after A is gone', leftMs !== null, `${leftMs} ms`);
  check('... within 40 s (35 s stale + a poll)', leftMs !== null && leftMs <= 40_000, `${leftMs} ms`);
  await B.ctx.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  for (const id of created) {
    await fetch(`${PB_URL}/api/collections/users/records/${id}`, { method: 'DELETE', headers: pbHeaders }).catch(() => {});
  }
}

console.log('\nTimings:');
for (const line of timings) console.log(`  ${line}`);
const bad = checks.filter(([, pass]) => !pass);
console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
process.exit(failed || bad.length ? 1 : 0);
