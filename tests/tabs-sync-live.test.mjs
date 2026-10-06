/** Is the tab really in time with the song? Measured in a real browser.
 *
 *  A song is made up here with KNOWN timing: a 48 bar tab at 100 bpm, played
 *  by a simple plucked synth at 104 bpm after 3.2 s of silence (so the tab
 *  has to be lined up, not just started at 0). It is uploaded with its tab
 *  (a Guitar Pro file), lined up by the server's real align.py ("Line it
 *  up"), and played on the tab page. Every 100 ms one evaluate reads, at the
 *  same instant:
 *
 *    - the audio element's currentTime (the truth: tab time is
 *      (t - 3.2) * 1.04 s, on the tab's own clock);
 *    - where AlphaTab thinks it is (its tick position);
 *    - the beat it highlights (the played beat, and the bar of it);
 *    - where its cursor is drawn (the animated line's x, turned back into
 *      tab time through the beats' positions on the page);
 *    - the bar the pill names.
 *
 *  The lag is reported in milliseconds of song (positive: the tab is
 *  ahead), as mean, 95th percentile and max, and the drift as the slope of
 *  the lag over the run (ms per minute). Scenarios: 100% speed from the top,
 *  a seek (the player's 5 s jumps), pause and resume, 75% speed, the delay
 *  set to +0.25 s, and a two-bar loop wrapping around.
 *
 *  Tolerances, and why: the line may sit up to 60 ms from the sound on
 *  average and 150 ms at worst (the eye forgives about 40 ms and notices
 *  100 ms; 150 ms is a quarter of a beat here and keeps the line on the
 *  right note), skipping the 300 ms after a jump (a seek, a loop wrap, a
 *  resume) that the page needs to hear about it (the player reports the
 *  position about four times a second). The highlighted beat must be the
 *  sounding one in 95% of samples, a beat boundary +-60 ms aside. Drift
 *  over the 100% run under 30 ms a minute.
 *
 *      node tests/tabs-sync-live.test.mjs          # or: npm run test:tabs-sync-live
 *
 *  Needs the app (APP_URL, default the tabs-redesign sandbox on 3066) built
 *  from this tree with MUSIC_DIR and PYTHON_BIN set, and a member to sign in
 *  as, through the app's own sign-in page:
 *    TAB_EMAIL / TAB_PASSWORD          an invited member, or
 *    INVITER_EMAIL / INVITER_PASSWORD  an admin of the app: a fresh
 *                                      @ember.test member is invited through
 *                                      /api/admin/invites and registers on
 *                                      the sign-in page.
 *  SYNC_SECONDS sets the 100% run (default 40). SHOTS=dir keeps screenshots.
 *  Writes every sample to $SYNC_OUT (default the OS temp dir) as JSON. */
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

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3066';
const SYNC_SECONDS = Number(process.env.SYNC_SECONDS ?? 40);
const OUT = process.env.SYNC_OUT ?? path.join(os.tmpdir(), `tabs-sync-live-${process.pid}.json`);
const run = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;

// ── the song ─────────────────────────────────────────────────────────────────
const TAB_BPM = 100;
const SONG_BPM = 104;
const INTRO_S = 3.2;
const BARS = 48;
const TPQ = 960; // AlphaTab ticks per quarter
const STRETCH = SONG_BPM / TAB_BPM; // tab seconds per song second
const BAR_TAB_MS = (4 * 60_000) / TAB_BPM;
const truthTabMs = (songSec) => (songSec - INTRO_S) * 1000 * STRETCH;
const tabMsToSong = (ms) => INTRO_S + ms / 1000 / STRETCH;

// Riffs, as (beats, [[fret, string], ...]); strings 1 (high e) to 6 (low E).
const RIFFS = {
  verse: [
    [[0.5, [[0, 6], [2, 5]]], [0.5, [[0, 6]]], [1, [[3, 6]]], [1, [[5, 6], [7, 5]]], [0.5, [[3, 6]]], [0.5, [[0, 6]]]],
    [[1, [[0, 6], [2, 5]]], [0.5, [[5, 5]]], [0.5, [[7, 5]]], [1, [[2, 5]]], [1, [[5, 6]]]],
  ],
  chorus: [
    [[1, [[0, 5], [2, 4], [2, 3]]], [0.5, [[0, 5]]], [0.5, [[3, 5]]], [2, [[3, 6], [5, 5], [5, 4]]]],
    [[1, [[1, 6], [3, 5], [3, 4]]], [0.5, [[3, 4]]], [0.5, [[5, 4]]], [1, [[3, 6], [5, 5]]], [1, [[0, 4]]]],
  ],
};
const BASE = [0, 64, 59, 55, 50, 45, 40];
const bars = [];
for (let s = 0; s < BARS / 8; s++) {
  const riff = RIFFS[s % 2 ? 'chorus' : 'verse'];
  for (let i = 0; i < 8; i++) bars.push(riff[i % 2]);
}

function alphaTex() {
  const dur = { 0.5: 8, 1: 4, 2: 2 };
  const body = bars
    .map((bar) =>
      bar
        .map(([beats, notes]) => {
          const n = notes.map(([f, s]) => `${f}.${s}`);
          return `${n.length > 1 ? `(${n.join(' ')})` : n[0]}.${dur[beats]}`;
        })
        .join(' '),
    )
    .join(' |\n');
  return `\\title "Sync Song ${run}"\n\\tempo ${TAB_BPM}\n\\track ("Guitar" "Gtr")\n\\instrument 25\n\\tuning (E4 B3 G3 D3 A2 E2)\n\\ts (4 4)\n${body}\n`;
}

async function guitarPro() {
  const at = await import(path.join(process.cwd(), 'node_modules/@coderline/alphatab/dist/alphaTab.mjs'));
  const settings = new at.Settings();
  const imp = new at.importer.AlphaTexImporter();
  imp.initFromString(alphaTex(), settings);
  return Buffer.from(new at.exporter.Gp7Exporter().export(imp.readScore(), settings));
}

/** The tab played: a plucked tone per note (four harmonics, a 3 ms attack,
 *  a 350 ms decay) and a click on every beat, at SONG_BPM from INTRO_S. */
function songWav(sr = 22050) {
  const lengthS = tabMsToSong(BARS * BAR_TAB_MS) + 3;
  const buf = new Float32Array(Math.ceil(lengthS * sr));
  const pluck = (at, midi, len) => {
    const i0 = Math.round(at * sr);
    const n = Math.min(Math.round(Math.min(len + 0.3, 1.5) * sr), buf.length - i0);
    const f = 440 * 2 ** ((midi - 69) / 12);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
      buf[i0 + i] += 0.25 * v * Math.exp(-t / 0.35) * Math.min(1, t / 0.003);
    }
  };
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const click = (at) => {
    const i0 = Math.round(at * sr);
    for (let i = 0; i < 0.02 * sr && i0 + i < buf.length; i++) buf[i0 + i] += 0.5 * rand() * Math.exp(-i / sr / 0.004);
  };
  bars.forEach((bar, b) => {
    let beat = 0;
    for (const [beats, notes] of bar) {
      const at = tabMsToSong(b * BAR_TAB_MS + (beat * 60_000) / TAB_BPM);
      for (const [fret, string] of notes) pluck(at, BASE[string] + fret, (beats * 60) / SONG_BPM);
      beat += beats;
    }
    for (let k = 0; k < 4; k++) click(tabMsToSong(b * BAR_TAB_MS + (k * 60_000) / TAB_BPM));
  });
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round((buf[i] / peak) * 0.8 * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// ── checks and numbers ───────────────────────────────────────────────────────
const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const r1 = (x) => Math.round(x * 10) / 10;
function stats(xs) {
  if (xs.length === 0) return { n: 0, mean: NaN, meanAbs: NaN, p95: NaN, max: NaN };
  const abs = xs.map(Math.abs).sort((a, b) => a - b);
  return {
    n: xs.length,
    mean: r1(xs.reduce((a, b) => a + b, 0) / xs.length),
    meanAbs: r1(abs.reduce((a, b) => a + b, 0) / abs.length),
    p95: r1(abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))]),
    max: r1(abs[abs.length - 1]),
  };
}
/** Least-squares slope of y over x, per minute of x (seconds). */
function slopePerMin(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? r1((num / den) * 60) : NaN;
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

// ── signing in, the app's own way ────────────────────────────────────────────
async function signIn(page, email, password) {
  await page.goto(`${APP_URL}/auth`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password').waitFor({ timeout: 15_000 }).catch(async () => {
    const said = await page.locator('form').innerText().catch(() => '(nothing)');
    throw new Error(`the sign-in page did not ask ${email} for a password: ${said.replace(/\s+/g, ' ')}`);
  });
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^(Log in|Register)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 20_000 }).catch(async () => {
    const said = await page.locator('form .text-destructive').innerText().catch(() => '(nothing)');
    throw new Error(`signing in as ${email} failed: ${said}`);
  });
}

async function member(browser) {
  if (process.env.TAB_EMAIL && process.env.TAB_PASSWORD) return { email: process.env.TAB_EMAIL, password: process.env.TAB_PASSWORD };
  if (!process.env.INVITER_EMAIL || !process.env.INVITER_PASSWORD) {
    console.error('Set TAB_EMAIL/TAB_PASSWORD (an invited member) or INVITER_EMAIL/INVITER_PASSWORD (an app admin who invites one).');
    process.exit(2);
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, process.env.INVITER_EMAIL, process.env.INVITER_PASSWORD);
  const email = `tabsync-${run}@ember.test`;
  const res = await ctx.request.post(`${APP_URL}/api/admin/invites`, { data: { email } });
  if (!res.ok()) throw new Error(`could not invite a member: ${res.status()} ${(await res.text()).slice(0, 200)}`);
  await ctx.close();
  return { email, password: `Sync-${run}-pw`, fresh: true };
}

// ── in the page: finding AlphaTab and reading it ─────────────────────────────
/** Test-only: the AlphaTab API the tab page built, found through React's
 *  fiber of the score element (a ref holding it), and every beat's tick and
 *  place on the page, for turning the cursor's x back into time. */
const PROBE = () => {
  window.__syncApi = () => {
    const el = document.querySelector('[data-testid="tab-score"]');
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    for (let f = key ? el[key] : null; f; f = f.return) {
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState?.current;
        if (v && typeof v === 'object' && typeof v.renderScore === 'function' && 'tickCache' in v) return v;
      }
    }
    return null;
  };
  window.__syncBeats = () => {
    const api = window.__syncApi();
    const lookup = api?.renderer?.boundsLookup;
    if (!api?.tickCache || !lookup) return [];
    const out = [];
    for (const bar of api.tracks?.[0]?.staves?.[0]?.bars ?? []) {
      for (const beat of bar.voices?.[0]?.beats ?? []) {
        const b = lookup.findBeat(beat);
        if (!b) continue;
        out.push({
          tick: api.tickCache.getBeatStart(beat),
          x: b.onNotesX,
          end: b.realBounds.x + b.realBounds.w,
          y: b.barBounds.masterBarBounds.visualBounds.y,
          bar: bar.index,
        });
      }
    }
    return out.sort((a, b) => a.tick - b.tick);
  };
  /** Every position the page feeds AlphaTab as playback, with the audio
   *  clock at that instant: the page's own estimate of the song time,
   *  before AlphaTab draws anything. */
  window.__feeds = [];
  const watchFeeds = (api) => {
    const out = api.player?.output;
    if (!out || out.__watched) return;
    const real = out.updatePosition.bind(out);
    out.updatePosition = (ms) => {
      const a = document.querySelector('audio');
      if (a && !a.paused) window.__feeds.push({ tabMs: ms * (api.playbackSpeed || 1), t: a.currentTime, at: performance.now() });
      if (window.__feeds.length > 4000) window.__feeds.splice(0, 1000);
      return real(ms);
    };
    out.__watched = true;
  };
  window.__syncSample = () => {
    const a = document.querySelector('audio');
    const s = { t: a ? a.currentTime : null, paused: a ? a.paused : null, rate: a ? a.playbackRate : null };
    const api = window.__syncApi();
    if (!api) return s;
    watchFeeds(api);
    s.feeds = window.__feeds.splice(0);
    s.tick = api.tickPosition;
    s.speed = api.playbackSpeed;
    const beat = api._currentBeat?.beat;
    if (beat) {
      s.beatTick = api.tickCache.getBeatStart(beat);
      s.beatBar = beat.voice.bar.index;
    }
    const cursor = document.querySelector('.at-cursor-beat');
    if (cursor) {
      const m = new DOMMatrixReadOnly(getComputedStyle(cursor).transform);
      s.cx = m.m41;
      s.cy = m.m42;
    }
    s.pill = document.querySelector('[data-testid="tab-pill-bar"]')?.textContent?.trim() ?? null;
    return s;
  };
};

/** The cursor's x on its row back to a tick: between the beat it is past
 *  and the next on the same row (or the row's last beat's right edge). */
function cursorTick(beats, cx, cy) {
  const row = beats.filter((b) => Math.abs(b.y - cy) < 2);
  if (row.length === 0) return null;
  let i = -1;
  for (let k = 0; k < row.length; k++) if (row[k].x <= cx + 0.5) i = k;
  if (i < 0) return row[0].tick;
  const here = row[i];
  const global = beats.indexOf(here);
  const next = beats[global + 1];
  const nextX = row[i + 1] ? row[i + 1].x : here.end;
  const nextTick = next ? next.tick : here.tick + TPQ;
  if (nextX <= here.x) return here.tick;
  return here.tick + Math.min(1.5, (cx - here.x) / (nextX - here.x)) * (nextTick - here.tick);
}
const tickMs = (tick) => (tick * 60_000) / (TAB_BPM * TPQ);

// ── run ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const who = await member(browser);
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx.addInitScript(PROBE);
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
await signIn(page, who.email, who.password);
check(`signed in as a member through the sign-in page${who.fresh ? ' (invited and registered just now)' : ''}`, true, who.email);

// The song and its tab, through the app's own routes.
const title = `Sync Song ${run}`;
const upload = await ctx.request.post(`${APP_URL}/api/uploads`, {
  multipart: { file: { name: 'sync-song.wav', mimeType: 'audio/wav', buffer: songWav() }, title, artist: 'Sync Tester' },
  timeout: 120_000,
});
if (!upload.ok()) throw new Error(`could not upload the song: ${upload.status()} ${(await upload.text()).slice(0, 200)}`);
const song = (await upload.json()).track;
const added = await ctx.request.post(`${APP_URL}/api/tabs/files`, {
  multipart: { file: { name: 'sync-song.gp', mimeType: 'application/octet-stream', buffer: await guitarPro() }, title, artist: 'Sync Tester', trackId: song.id },
});
if (!added.ok()) throw new Error(`could not add the tab: ${added.status()} ${(await added.text()).slice(0, 200)}`);
const tab = (await added.json()).tab;

// Line it up, as the button does, and wait for align.py.
const started = Date.now();
const go = await ctx.request.post(`${APP_URL}/api/tabs/align`, { data: { tabId: tab.id } });
check('Line it up starts', go.status() === 202, `${go.status()}`);
let aligned = { status: 'running' };
while (aligned.status === 'running' && Date.now() - started < 180_000) {
  await new Promise((r) => setTimeout(r, 1500));
  aligned = await (await ctx.request.get(`${APP_URL}/api/tabs/align?tabId=${encodeURIComponent(tab.id)}`)).json();
}
const timing = aligned.timing;
check('align.py lines the Guitar Pro tab up', aligned.status === 'ready' && !!timing, `${aligned.status}${aligned.error ? `: ${aligned.error}` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
const report = { app: APP_URL, timing: timing ? { offsetMs: timing.offsetMs, bpm: timing.bpm, confidence: timing.confidence } : null, scenarios: {} };
if (timing) {
  const errs = timing.bars.map((b) => b.ms - tabMsToSong(b.bar * BAR_TAB_MS) * 1000);
  const s = stats(errs);
  report.alignment = s;
  check(
    'the server put every bar within 50 ms of where it sounds',
    s.max < 50 && timing.bars.length === BARS,
    `confidence ${Math.round(timing.confidence * 100)}%, bar 1 at ${timing.offsetMs} ms (truth ${INTRO_S * 1000}), bars mean ${s.meanAbs} ms, max ${s.max} ms, ${timing.bpm} bpm (truth ${SONG_BPM})`,
  );
}

// Play it from the uploads list, then go to the tab in-app so it keeps playing.
await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
await page.getByText(title, { exact: true }).first().click({ clickCount: 2 });
await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > 0; }, null, { timeout: 20_000 });
await page.getByRole('button', { name: 'Guitar tabs' }).first().click();
await page.waitForFunction(() => document.querySelector('[data-testid="tab-score"]')?.dataset.status === 'ready', null, { timeout: 30_000 });
await page.waitForFunction(() => !!window.__syncApi()?.tickCache, null, { timeout: 15_000 });
let beats = await page.evaluate(() => window.__syncBeats());
check('the probe reads AlphaTab and its beats', beats.length > BARS * 3, `${beats.length} beats`);

const samples = [];
const sleep = (ms) => page.waitForTimeout(ms);
/** Sample every ~100 ms for `seconds` of wall clock under `label`. */
async function sampleFor(label, seconds, { delayMs = 0 } = {}) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const s = await page.evaluate(() => window.__syncSample());
    s.label = label;
    s.wall = Date.now();
    s.delayMs = delayMs;
    samples.push(s);
    await sleep(100);
  }
}
const audio = (fn, arg) => page.evaluate(fn, arg);
const cell = (id) => page.getByTestId(`tab-tool-${id}`);
const pop = (id) => page.getByTestId(`tab-popover-${id}`);
const bodyKey = async (key) => {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(key);
};

/** One scenario's numbers: the lag of AlphaTab's position, its drawn
 *  cursor and its highlighted beat against the truth, in song ms. A jump
 *  is the scenario's start (it follows an action: a seek, a resume, a new
 *  speed) or a jump in the audio time (a loop wrapping); the `settleMs`
 *  after one are left out of the lag and measured on their own: how long
 *  until the line is within 150 ms of the song again. */
function analyse(label, { settleMs = 300 } = {}) {
  const rows = samples.filter((s) => s.label === label);
  const truth = (s) => truthTabMs(s.t + s.delayMs / 1000);
  const toSong = (tabMsErr) => tabMsErr / STRETCH;
  const curErr = (s) => {
    if (s.cx === undefined || s.t === null) return null;
    const tick = cursorTick(beats, s.cx, s.cy);
    return tick === null ? null : toSong(tickMs(tick) - truth(s));
  };
  const jumpsAt = rows.length ? [rows[0].wall] : [];
  for (let i = 1; i < rows.length; i++) {
    const s = rows[i];
    const prev = rows[i - 1];
    if (s.t === null || prev.t === null) continue;
    const expected = prev.t + ((s.wall - prev.wall) / 1000) * (prev.paused ? 0 : prev.rate || 1);
    if (Math.abs(s.t - expected) > 0.35) jumpsAt.push(s.wall);
  }
  // A jump into the silent intro (the run from the top) has no line to wait for.
  const settle = jumpsAt.filter((j) => (rows.find((s) => s.wall === j)?.t ?? 0) >= INTRO_S + 0.3).map((j) => {
    const back = rows.find((s) => s.wall >= j && s.t !== null && s.t >= INTRO_S + 0.3 && Math.abs(curErr(s) ?? Infinity) < 150);
    return back ? back.wall - j : Infinity;
  });
  const kept = rows.filter(
    (s) => s.t !== null && s.t >= INTRO_S + 0.3 && s.tick !== undefined && !jumpsAt.some((j) => s.wall >= j && s.wall - j < settleMs),
  );
  const pos = kept.map((s) => toSong(tickMs(s.tick) - truth(s)));
  const fed = kept.flatMap((s) => (s.feeds ?? []).filter((f) => f.t >= INTRO_S + 0.3).map((f) => toSong(f.tabMs - truthTabMs(f.t + s.delayMs / 1000))));
  const cur = kept.map(curErr);
  const curOk = cur.filter((x) => x !== null);
  let beatRight = 0;
  let beatCounted = 0;
  let pillRight = 0;
  let pillCounted = 0;
  for (const s of kept) {
    const tms = truth(s);
    const idx = beats.findIndex((b, k) => tickMs(b.tick) <= tms && (k === beats.length - 1 || tickMs(beats[k + 1].tick) > tms));
    const near = beats.some((b) => Math.abs(tickMs(b.tick) - tms) < 60 * STRETCH);
    if (s.beatTick !== undefined && idx >= 0 && !near) {
      beatCounted++;
      if (s.beatTick === beats[idx].tick) beatRight++;
    }
    const bar = Math.floor(tms / BAR_TAB_MS) + 1;
    const nearBar = Math.abs(tms - Math.round(tms / BAR_TAB_MS) * BAR_TAB_MS) < 300 * STRETCH;
    const m = /Bar (\d+)/.exec(s.pill ?? '');
    if (m && !nearBar) {
      pillCounted++;
      if (Number(m[1]) === bar) pillRight++;
    }
  }
  const out = {
    samples: rows.length,
    kept: kept.length,
    jumps: jumpsAt.length - 1,
    settleMs: settle.length ? Math.max(...settle) : 0,
    estimate: stats(fed),
    position: stats(pos),
    cursor: stats(curOk),
    driftMsPerMin: slopePerMin(kept.filter((_, i) => cur[i] !== null).map((s) => s.t), curOk),
    beatRight: beatCounted ? r1((100 * beatRight) / beatCounted) : NaN,
    pillRight: pillCounted ? r1((100 * pillRight) / pillCounted) : NaN,
  };
  report.scenarios[label] = out;
  console.log(
    `      ${label}: cursor lag mean ${out.cursor.mean} ms (|mean| ${out.cursor.meanAbs}, p95 ${out.cursor.p95}, max ${out.cursor.max}), ` +
      `page estimate mean ${out.estimate.mean} ms (max ${out.estimate.max}), AlphaTab position mean ${out.position.mean} ms (max ${out.position.max}), drift ${out.driftMsPerMin} ms/min, ` +
      `beat right ${out.beatRight}%, pill bar right ${out.pillRight}%, back in line within ${out.settleMs} ms, ` +
      `${out.kept}/${out.samples} samples, ${out.jumps} jumps`,
  );
  return out;
}
function judge(label, out, { drift = false } = {}) {
  const ok = out.kept >= 10 && out.cursor.meanAbs < 60 && out.cursor.max < 150 && out.beatRight >= 95;
  check(`${label}: the line stays with the song`, ok, `|mean| ${out.cursor.meanAbs} ms, p95 ${out.cursor.p95} ms, max ${out.cursor.max} ms, beat right ${out.beatRight}%`);
  check(`${label}: back in line within 400 ms of the jump`, out.settleMs <= 400, `${out.settleMs} ms`);
  if (drift) check(`${label}: no drift`, Math.abs(out.driftMsPerMin) < 30, `${out.driftMsPerMin} ms/min`);
}

// 1. 100% from the top (the song has been playing since the click).
await sampleFor('100%', SYNC_SECONDS);
judge('100%', analyse('100%'), { drift: true });
if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'sync-100.png') });

// 2. A seek: three of the player's 5 s jumps forward.
for (let i = 0; i < 3; i++) await bodyKey('ArrowRight');
await sampleFor('seek', 8);
judge('after a seek', analyse('seek'));

// 3. Pause, then resume: paused, the line holds where the song stopped.
await bodyKey('Space');
await page.waitForFunction(() => document.querySelector('audio')?.paused === true, null, { timeout: 5000 });
await sleep(400);
await sampleFor('paused', 2);
{
  const out = analyse('paused');
  check('paused: the line stays where the song stopped', out.kept >= 5 && out.cursor.max < 150, `max ${out.cursor.max} ms`);
}
await bodyKey('Space');
await page.waitForFunction(() => document.querySelector('audio')?.paused === false, null, { timeout: 5000 });
await sampleFor('resume', 8);
judge('after pause and resume', analyse('resume'));

// 4. 75% speed, pitch kept, from bar 9.
await cell('speed').click();
await pop('speed').getByRole('button', { name: '75%' }).click();
await cell('speed').click();
await page.evaluate((t) => { document.querySelector('audio').currentTime = t; }, tabMsToSong(8 * BAR_TAB_MS));
await sampleFor('75%', 15);
const at75 = await audio(() => document.querySelector('audio').playbackRate);
check('75%: the recording plays at 0.75', Math.abs(at75 - 0.75) < 1e-6, `${at75}`);
judge('75% speed', analyse('75%'), { drift: true });
await cell('speed').click();
await pop('speed').getByRole('button', { name: '100%' }).click();
await cell('speed').click();

// 5. The delay set to +0.25 s: the tab runs a quarter second ahead.
await cell('delay').click();
await pop('delay').getByLabel('Tab timing offset, exact seconds').fill('0.25');
await cell('delay').click();
await sampleFor('delay +0.25 s', 8, { delayMs: 250 });
judge('delay +0.25 s', analyse('delay +0.25 s'));
await cell('delay').click();
await pop('delay').getByRole('button', { name: 'Reset' }).click();
await cell('delay').click();

// 6. A two-bar loop (bars 10 and 11), wrapping around a few times.
await cell('loop').click();
await pop('loop').getByLabel('Loop from bar').fill('10');
await pop('loop').getByLabel('Loop to bar').fill('11');
await cell('loop').click();
await sleep(600);
await sampleFor('loop', 16);
{
  const out = analyse('loop');
  check('the loop wrapped around', out.jumps >= 2, `${out.jumps} wraps`);
  judge('loop wrap-around', out);
}
await cell('loop').click();
await pop('loop').getByRole('button', { name: 'Clear' }).click().catch(() => {});

fs.writeFileSync(OUT, JSON.stringify({ report, samples, beats }, null, 1));
console.log(`\nsamples and numbers: ${OUT}`);
check('no page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// Clean up what this run added.
await ctx.request.delete(`${APP_URL}/api/tabs/files/${encodeURIComponent(tab.id)}`).catch(() => {});
await ctx.request.delete(`${APP_URL}/api/uploads/${encodeURIComponent(String(song.id).replace(/^upload:/, ''))}`).catch(() => {});
await browser.close();
const failed = checks.filter(([, p]) => !p).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
