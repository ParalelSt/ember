/** A song that will not load must FAIL, quickly, not freeze the app.
 *
 *      node tests/stream-fastfail.test.mjs   # or: npm run test:stream-fastfail
 *
 *  The incident: the host's yt-dlp went stale, its download 403'd, the stream
 *  route fell through to proxying a live stream that could not stand in
 *  either, and the request then either ran a second yt-dlp round before
 *  answering or never answered at all. The desktop app sat on the song for 25
 *  seconds ("timed out decoding the track after 25s") before giving up.
 *
 *  Every mode below is a way that fallback can fail, driven end to end against
 *  a real app server with tests/fake-player.sh as the player (its download
 *  always 403s, FAKE_FAIL_DOWNLOAD=1) and a fake googlevideo this test
 *  controls. What is measured is TIME TO AN ANSWER: a player cannot tell a
 *  server that is still working from one that never will, so an answer that
 *  never comes is what the freeze was made of.
 *
 *  Starts its own app server from the existing build in apps/web. No
 *  PocketBase needed: the stream route's writes are fire-and-forget.
 *
 *  Env: APP_PORT (default 3038), ORIGIN_PORT (default 4462), SB (scratch dir).
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const PORT = process.env.APP_PORT ?? '3038';
const APP_URL = `http://127.0.0.1:${PORT}`;
const ORIGIN_PORT = Number(process.env.ORIGIN_PORT ?? 4462);
const SB = process.env.SB ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ember-fastfail-'));
const MUSIC = path.join(SB, 'music');
const CALLS = path.join(SB, 'calls.log');

/** Budgets the app promises. Generous versions of the real ones (6s to the
 *  upstream's headers, 10s of silence in a body), so a loaded machine cannot
 *  make this flap: what is being caught is an answer that never comes. */
const QUICK_MS = 4_000;
const HEADERS_MS = 12_000;
const STALL_MS = 20_000;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const videoId = () => Array.from({ length: 11 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

// ── the fake googlevideo ────────────────────────────────────────────────────
// `mode` is swapped between checks; every request reads whatever is set now.
const AUDIO = Buffer.alloc(64 * 1024, 7);
let mode = 'ok';
const sockets = new Set();
const origin = http.createServer((req, res) => {
  if (mode === 'forbidden') { res.writeHead(403); res.end('Forbidden'); return; }
  // Accepts the request and answers nothing, ever: an upstream that has gone
  // away without closing the connection.
  if (mode === 'silent') return;
  if (mode === 'ok') {
    res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': String(AUDIO.length) });
    res.end(AUDIO);
    return;
  }
  if (mode === 'stall-body') {
    // Headers and a first chunk, then silence: the shape that produced the
    // 25s freeze, because a 200 with no more bytes looks like a slow song.
    res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': String(AUDIO.length * 4) });
    res.write(AUDIO.subarray(0, 1024));
    return;
  }
  if (mode === 'slow') {
    // Slow but PROGRESSING, in eight pieces over ~4s: must arrive in full.
    res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': String(AUDIO.length) });
    let sent = 0;
    const piece = AUDIO.length / 8;
    const tick = setInterval(() => {
      res.write(AUDIO.subarray(sent, sent + piece));
      sent += piece;
      if (sent >= AUDIO.length) { clearInterval(tick); res.end(); }
    }, 500);
    req.on('close', () => clearInterval(tick));
    return;
  }
  res.writeHead(500); res.end('x');
});
origin.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

async function startApp() {
  const child = spawn('npx', ['next', 'start', '-p', PORT, '-H', '127.0.0.1'], {
    cwd: WEB,
    env: {
      ...process.env,
      STREAM_MODE: '',
      PYTHON_BIN: '/bin/bash',
      PLAYER_SCRIPT: path.join(ROOT, 'tests/fake-player.sh'),
      // The one constant across every mode: yt-dlp's downloader is refused,
      // exactly as a stale yt-dlp behaves.
      FAKE_FAIL_DOWNLOAD: '1',
      FAKE_STREAM_URL: `http://127.0.0.1:${ORIGIN_PORT}/audio`,
      MUSIC_DIR: MUSIC,
      FAKE_PLAYER_LOG: CALLS,
      STREAM_CACHE_WARM: '0',
      DISCORD_BUG_REPORT_WEBHOOK_URL: 'http://127.0.0.1:1/none',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString(); });
  for (let i = 0; i < 60; i++) {
    const up = await fetch(APP_URL).then(() => true, () => false);
    if (up) return child;
    await sleep(500);
  }
  child.kill();
  throw new Error(`app did not start on ${PORT}: ${err.slice(-400)}`);
}

async function stopApp(child) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  for (let i = 0; i < 20; i++) {
    const up = await fetch(APP_URL).then(() => true, () => false);
    if (!up) return;
    await sleep(250);
  }
}

/** One play attempt: how long the headers took, how long the body took, and
 *  whether the body completed or broke. */
async function play(id, capMs) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${APP_URL}/api/youtube/stream/${id}`, { signal: AbortSignal.timeout(capMs) });
  } catch (e) {
    return { headersMs: Date.now() - started, answered: false, error: String(e) };
  }
  const headersMs = Date.now() - started;
  const bodyAt = Date.now();
  let body = null;
  let bodyBroke = false;
  try {
    body = Buffer.from(await res.arrayBuffer());
  } catch {
    bodyBroke = true;
  }
  return {
    answered: true,
    headersMs,
    bodyMs: Date.now() - bodyAt,
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body,
    bodyBroke,
    json: () => { try { return JSON.parse(body?.toString('utf8') ?? ''); } catch { return {}; } },
  };
}

const callsFor = (id) => (fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').split('\n') : [])
  .filter((l) => l.trim().endsWith(` ${id}`));

// Guard: never collide with something already on either port.
if (await fetch(APP_URL).then(() => true, () => false)) {
  console.error(`Something already listens on ${APP_URL}; set APP_PORT to a free port.`);
  process.exit(2);
}
fs.rmSync(MUSIC, { recursive: true, force: true });
fs.mkdirSync(MUSIC, { recursive: true });
fs.rmSync(CALLS, { force: true });
await new Promise((r, j) => { origin.once('error', j); origin.listen(ORIGIN_PORT, '127.0.0.1', r); });

let app;
try {
  app = await startApp();

  // ── F1: the fallback that works still works ───────────────────────────────
  mode = 'ok';
  const good = await play(videoId(), 15_000);
  check('F1 a failed download still falls through to the live stream',
    good.status === 200 && good.body?.length === AUDIO.length, `status ${good.status}`);

  // ── F2/F3: the live stream is refused too ─────────────────────────────────
  mode = 'forbidden';
  const refusedId = videoId();
  const refused = await play(refusedId, 60_000);
  check('F2 a play nothing can serve answers a real error status',
    refused.status === 502, `status ${refused.status}`);
  check('F2 quickly, rather than after another yt-dlp round',
    refused.headersMs < QUICK_MS, `${refused.headersMs}ms`);
  const message = String(refused.json().error ?? '');
  check('F2 and says so in a sentence a listener could read',
    /could not be loaded/i.test(message) && !message.includes('Traceback') && !message.includes('/opt/'),
    message.slice(0, 100));
  // The old cascade asked yt-dlp twice over (a second URL extraction, then a
  // second download) before admitting defeat: seconds each, for an answer it
  // already had.
  const calls = callsFor(refusedId);
  check('F3 it asked yt-dlp once, not twice over',
    calls.filter((l) => l.startsWith('download')).length === 1
    && calls.filter((l) => l.startsWith('info')).length === 1,
    calls.join(', '));

  // ── F4: the live stream accepts and never answers ─────────────────────────
  mode = 'silent';
  const silent = await play(videoId(), 90_000);
  check('F4 an upstream that never answers does not become an endless wait',
    silent.answered && silent.status === 502, silent.answered ? `status ${silent.status}` : silent.error);
  check('F4 and is given up on inside the headers budget',
    silent.headersMs < HEADERS_MS, `${silent.headersMs}ms`);
  // Free the sockets the silent mode left hanging.
  for (const s of sockets) s.destroy();

  // ── F5: the body stops mid-transfer ───────────────────────────────────────
  mode = 'stall-body';
  const stalled = await play(videoId(), 90_000);
  check('F5 a body that stops mid-transfer breaks instead of hanging',
    stalled.bodyBroke, stalled.bodyBroke ? '' : `got ${stalled.body?.length} bytes`);
  check('F5 within the stall budget',
    (stalled.bodyMs ?? Infinity) < STALL_MS, `${stalled.bodyMs}ms`);
  for (const s of sockets) s.destroy();

  // ── F6: slow is not the same as dead ──────────────────────────────────────
  mode = 'slow';
  const slow = await play(videoId(), 60_000);
  check('F6 a slow but progressing stream is delivered in full, not cut off',
    slow.status === 200 && !slow.bodyBroke && slow.body?.length === AUDIO.length,
    `status ${slow.status}, ${slow.body?.length} bytes in ${slow.bodyMs}ms`);
  check('F6 and it really was slower than the stall budget allows for silence',
    (slow.bodyMs ?? 0) > 3_000, `${slow.bodyMs}ms`);

  // ── F7: nothing listening upstream at all ─────────────────────────────────
  await new Promise((r) => origin.close(r));
  for (const s of sockets) s.destroy();
  const dead = await play(videoId(), 60_000);
  check('F7 an upstream that is not there at all is a clear error, quickly',
    dead.status === 502 && dead.headersMs < QUICK_MS,
    `status ${dead.status} in ${dead.headersMs}ms`);
  check('F7 with the same readable message',
    /could not be loaded/i.test(String(dead.json().error ?? '')),
    String(dead.json().error ?? '').slice(0, 100));
} finally {
  if (app) await stopApp(app);
  for (const s of sockets) s.destroy();
  origin.close();
}

const failed = checks.filter(([, pass]) => !pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
