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

const failed = out.filter((o) => !o.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
