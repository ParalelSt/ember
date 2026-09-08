/** Which length the player believes a song is.
 *
 *      node tests/duration.test.mjs   # or: npm run test:duration
 *
 *  Reported on the native apps: song lengths were wrong, and the player sat
 *  waiting for a duration that was never this song's. Cause: duration was only
 *  written when the audio engine reported one, and the desktop decoder,
 *  streaming over HTTP, frequently reports nothing. So the slider kept the
 *  PREVIOUS song's length.
 *
 *  Pure logic — no server, browser or audio device. */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../apps/web/lib/playback/chooseDuration.ts', import.meta.url), 'utf8');
const js = src
  .replace(/export function chooseDuration\(catalogSec: number, reportedSec: number \| null \| undefined\): number/,
           'function chooseDuration(catalogSec, reportedSec)')
  .replace(/function sane\(v: number \| null \| undefined\): number/, 'function sane(v)')
  .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*$/gm, '');
const { chooseDuration } = await import(
  `data:text/javascript,${encodeURIComponent(`${js}\nexport { chooseDuration };`)}`
);

const out = [];
const check = (name, fn) => {
  try { fn(); out.push([name, true]); console.log(`PASS  ${name}`); }
  catch (e) { out.push([name, false]); console.log(`FAIL  ${name}  — ${e.message}`); }
};

check('the reported bug: engine says nothing, catalog wins', () => {
  // Desktop: rodio's total_duration() over an HTTP stream is often None.
  assert.equal(chooseDuration(213, null), 213);
  assert.equal(chooseDuration(213, undefined), 213);
  assert.equal(chooseDuration(213, 0), 213);
});

check('a song never inherits the previous song’s length', () => {
  // Song A was 300s. Song B is 180s and its engine reports nothing.
  // The answer must be B's length, never A's.
  const shown = chooseDuration(180, null);
  assert.equal(shown, 180, `slider showed ${shown}`);
});

check('a wildly wrong engine figure is rejected', () => {
  assert.equal(chooseDuration(200, 4000), 200);
  assert.equal(chooseDuration(200, 12), 200);
});

check('an engine figure that agrees is preferred (more precise for seeking)', () => {
  assert.equal(chooseDuration(200, 203), 203);
  assert.equal(chooseDuration(200, 197.5), 197.5);
});

check('exactly at the agreement edge still counts as agreeing', () => {
  assert.equal(chooseDuration(200, 220), 220);
  assert.equal(chooseDuration(200, 180), 180);
});

check('no catalog length falls back to the engine', () => {
  assert.equal(chooseDuration(0, 245), 245);
});

check('nonsense from either side yields 0, not NaN or Infinity', () => {
  for (const bad of [NaN, Infinity, -5, null, undefined]) {
    const v = chooseDuration(bad, bad);
    assert.equal(v, 0, `got ${v} for ${String(bad)}`);
  }
  assert.equal(chooseDuration(0, 999999), 0, 'a day-long "song" is nonsense');
});

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
