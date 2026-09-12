/** Generated guitar tabs.
 *
 *      node tests/tabs-generate.test.mjs      # or: npm run test:tabs-generate
 *
 *  Section A runs transcribe.py itself on a synthetic four-note wav and
 *  checks the alphaTex it writes. Needs the Python deps from requirements.txt
 *  (Demucs is skipped with --skip-separation, so it is not required).
 *
 *  Section B hits the route in the sandbox from tests/README.md (PB 8091,
 *  app 3010, TRANSCRIBE_SCRIPT pointed at tests/fake-transcribe.sh). */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PYTHON = process.env.PYTHON_BIN ?? path.join(ROOT, '.venv/bin/python');

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ── A. transcribe.py on a synthetic recording ──────────────────────────────
/** Four plucked notes, one per beat at 120 BPM: E2 A2 D3 G3. Each has a few
 *  harmonics and a decay so the model hears a string, not a test tone. */
function pluckWav(freqs, seconds = 0.5, sampleRate = 22050) {
  const perNote = Math.round(seconds * sampleRate);
  const total = perNote * freqs.length + sampleRate; // a second of silence at the end
  const data = Buffer.alloc(total * 2);
  freqs.forEach((f, n) => {
    for (let i = 0; i < perNote; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-3 * t);
      const v = env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
      data.writeInt16LE(Math.round(9000 * v), (n * perNote + i) * 2);
    }
  });
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-tabgen-'));
  const wav = path.join(dir, 'four-notes.wav');
  const tex = path.join(dir, 'four-notes.alphatex');
  fs.writeFileSync(wav, pluckWav([82.41, 110.0, 146.83, 196.0]));

  let stdout = '';
  let failed = null;
  try {
    stdout = execFileSync(PYTHON, [path.join(ROOT, 'transcribe.py'), wav, tex, '--skip-separation', '--title', 'Four Notes'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
  } catch (e) {
    failed = String(e.stderr || e.message).trim().split('\n').slice(-3).join(' | ');
  }
  check('transcribe.py exits cleanly', failed === null, failed ?? '');

  let summary = null;
  try { summary = JSON.parse(stdout.trim().split('\n').pop()); } catch {}
  check('it prints a JSON summary', !!summary && typeof summary.notes === 'number' && typeof summary.bars === 'number',
    stdout.trim().slice(-120));

  const text = fs.existsSync(tex) ? fs.readFileSync(tex, 'utf8') : '';
  check('it writes an alphaTex file', text.length > 0);
  check('the file names the song', text.includes('\\title "Four Notes"'));
  check('the file has a tempo', /\\tempo \d+/.test(text));
  check('the file has bar lines', text.includes('|'));

  // Lowest-fret placement: each of these is an open string.
  const tokens = ['0.6', '0.5', '0.4', '0.3'];
  const positions = tokens.map((t) => text.search(new RegExp(`(^|[\\s(])${t.replace('.', '\\.')}(\\.|\\s|\\))`)));
  check('E2 A2 D3 G3 land on the open E A D G strings', positions.every((p) => p >= 0),
    `found at ${positions.join(', ')}`);
  check('and in that order', positions.every((p, i) => i === 0 || p > positions[i - 1]));

  if (process.env.DEBUG_TABS) console.log(text);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── B. the route, against the sandbox with the fake transcriber ─────────────
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3010';
const PW = 'BugTest2026!';

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no admin');
}

async function user(label, tok) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
  const rec = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true }) })
    .then((r) => r.json());
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })
    .then((r) => r.json());
  return { id: rec.id, cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}` };
}

const as = (u, p, init = {}) => fetch(APP + p, { ...init, redirect: 'manual', headers: { ...(init.headers || {}), cookie: u.cookie } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny playable upload, so the route has a real file on disk to hand the
 *  (fake) transcriber. Same trick as tests/tabs-ui.test.mjs. */
function silentWav(seconds = 2, sampleRate = 8000) {
  const data = Buffer.alloc(seconds * sampleRate * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

{
  const tok = await adminToken();
  const alice = await user('gen-alice', tok);
  const bob = await user('gen-bob', tok);
  const log = process.env.FAKE_TRANSCRIBE_LOG ?? '/tmp/fake-transcribe.log';
  fs.writeFileSync(log, '');

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(silentWav())], { type: 'audio/wav' }), 'quiet.wav');
  form.append('title', `Gen Test ${Date.now()}`);
  form.append('artist', 'Gen Tester');
  const up = await as(alice, '/api/uploads', { method: 'POST', body: form }).then((r) => r.json());
  const trackId = up.track?.id;
  check('a song is seeded for the route tests', typeof trackId === 'string' && trackId.startsWith('upload:'), JSON.stringify(up).slice(0, 120));

  const anon = await fetch(`${APP}/api/tabs/generated/${encodeURIComponent(trackId)}`, { method: 'POST', redirect: 'manual' });
  check('POST without a session is refused', anon.status === 401 || anon.status === 302 || anon.status === 307, `status ${anon.status}`);

  const bad = await as(alice, '/api/tabs/generated/spotify%3Aabc', { method: 'POST' });
  check('a source Ember does not have audio for is 400', bad.status === 400, `status ${bad.status}`);
  const bad2 = await as(alice, '/api/tabs/generated/youtube%3A..%2F..%2Fetc', { method: 'POST' });
  check('a traversal-shaped id is 400', bad2.status === 400, `status ${bad2.status}`);

  const none = await as(alice, `/api/tabs/generated/${encodeURIComponent(trackId)}`);
  check('GET before any job is 404', none.status === 404, `status ${none.status}`);

  const first = await as(alice, `/api/tabs/generated/${encodeURIComponent(trackId)}`, { method: 'POST' });
  check('the first POST starts a job (202)', first.status === 202, `status ${first.status}`);
  const second = await as(bob, `/api/tabs/generated/${encodeURIComponent(trackId)}`, { method: 'POST' });
  check('a second member asking joins it (202)', second.status === 202, `status ${second.status}`);
  const running = await as(alice, `/api/tabs/generated/${encodeURIComponent(trackId)}`);
  check('GET while running is 202', running.status === 202, `status ${running.status}`);

  let ready = null;
  for (let i = 0; i < 20 && !ready; i++) {
    await sleep(500);
    const r = await as(bob, `/api/tabs/generated/${encodeURIComponent(trackId)}`);
    if (r.status === 200) ready = r;
  }
  check('GET becomes 200 when the job finishes', !!ready);
  const text = ready ? await ready.text() : '';
  check('and serves the alphaTex as text/plain', !!ready && (ready.headers.get('content-type') || '').startsWith('text/plain') && text.includes('\\title'),
    ready ? ready.headers.get('content-type') : '');
  check('anyone signed in can read it (shared like the audio cache)', !!ready && text.length > 0);

  const jobs = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  check('exactly one transcription ran for two requests', jobs.length === 1, `${jobs.length} job(s)`);

  const again = await as(alice, `/api/tabs/generated/${encodeURIComponent(trackId)}`, { method: 'POST' });
  check('POST for a finished tab is 200 and does not rerun', again.status === 200, `status ${again.status}`);
  const jobsAfter = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  check('still one job', jobsAfter.length === 1, `${jobsAfter.length} job(s)`);
}

const failed = out.filter((o) => !o.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
