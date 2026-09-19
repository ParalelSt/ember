/** Where the notes of a generated tab land against the recording.
 *
 *      node tests/transcribe-timing.test.mjs      # or: npm run test:transcribe-timing
 *
 *  transcribe.py lays notes on a grid of tracked beats and writes a tempo
 *  per bar. The tab page plays tab time 0 at song time 0, so a note that
 *  sounds at 42.0 s in the recording has to sit at 42.0 s on the tab's
 *  clock, or the line reaches it early or late. This drives the pure part
 *  of transcribe.py (beat_grid, to_alphatex) with synthetic beats, no audio
 *  and no ML: only the Python standard library is needed, from the venv
 *  (PYTHON_BIN) or the system python3. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const venv = path.join(ROOT, '.venv/bin/python');
const PYTHON = process.env.PYTHON_BIN ?? (fs.existsSync(venv) ? venv : 'python3');

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` : ${detail}` : ''}`);
};

/** Runs transcribe.py's grid and alphaTex writer on a steady beat, one note
 *  on every beat for `bars` bars, and reads the tab back: for every note,
 *  where it sounds in the song and where it sits on the tab's clock. */
function place({ bpm, firstBeat, bars, duration }) {
  const py = `
import json, re, sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
import transcribe as t
step = 60.0 / ${bpm}
beats = [${firstBeat} + i * step for i in range(int(${duration} / step))]
grid = t.beat_grid(beats, ${duration})
onsets = beats[: ${bars} * 4]
notes = [(b + 0.01, b + 0.2, 52) for b in onsets]
tex = t.to_alphatex(sorted(notes), grid, "x")
SLOTS = {"1": 16, "2": 8, "4": 4, "8": 2, "16": 1}
clock, placed = 0.0, []
for line in tex.split("\\n"):
    m = re.match(r"\\\\tempo ([0-9.]+) (.*)\\|$", line.strip())
    if not m:
        continue
    bar_bpm, body = float(m.group(1)), m.group(2)
    slot = 0
    for tok in re.finditer(r"(\\([^)]*\\)|r|\\d+\\.\\d+)\\.(\\d+)", body):
        if tok.group(1) != "r":
            placed.append(clock + slot * 60.0 / bar_bpm / 4)
        slot += SLOTS[tok.group(2)]
    clock += slot * 60.0 / bar_bpm / 4
print(json.dumps({"onsets": [b + 0.01 for b in onsets], "placed": placed, "step": step}))
`;
  return JSON.parse(execFileSync(PYTHON, ['-c', py], { encoding: 'utf8' }).trim().split('\n').pop());
}

const cases = [
  // A tempo that does not round to a whole bpm, the first beat a third of
  // a beat in: the two ways the line used to drift from the notes.
  { name: '97.4 bpm, first beat at 0.35s', bpm: 97.4, firstBeat: 0.35, bars: 72, duration: 200 },
  // The first beat most of a beat in.
  { name: '120.6 bpm, first beat at 0.45s', bpm: 120.6, firstBeat: 0.45, bars: 80, duration: 170 },
];

for (const c of cases) {
  let r;
  try {
    r = place(c);
  } catch (e) {
    check(`${c.name}: transcribe.py lays the notes out`, false, String(e.stderr || e.message).trim().split('\n').slice(-2).join(' | '));
    continue;
  }
  check(`${c.name}: every note is in the tab`, r.placed.length === r.onsets.length, `${r.placed.length} of ${r.onsets.length}`);
  const err = r.onsets.map((s, i) => (r.placed[i] ?? NaN) - s);
  // A 16th of quantization, which lands a note at most one slot early.
  const slot = r.step / 4;
  const afterFirstBar = err.slice(4);
  const worst = Math.max(...afterFirstBar.map(Math.abs));
  check(
    `${c.name}: after the first bar every note sits on the tab clock where it sounds (within a 16th)`,
    worst <= slot + 0.02,
    `worst ${worst.toFixed(3)}s (a 16th is ${slot.toFixed(3)}s); bar 2 ${err[4].toFixed(3)}s, last bar ${err.at(-1).toFixed(3)}s`,
  );
  const drift = err.at(-1) - err[4];
  check(
    `${c.name}: no drift over ${c.bars} bars (${((c.bars * 4 * 60) / c.bpm / 60).toFixed(1)} min)`,
    Math.abs(drift) <= 0.05,
    `${drift.toFixed(3)}s between bar 2 and the last bar`,
  );
  const first = Math.max(...err.slice(0, 4).map(Math.abs));
  check(`${c.name}: the first bar is within half a beat`, first <= r.step / 2, `worst ${first.toFixed(3)}s`);
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
process.exit(failed.length ? 1 : 0);
