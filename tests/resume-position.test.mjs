/** Which position a song starts at, and whose position it is.
 *
 *      node tests/resume-position.test.mjs   # or: npm run test:resume
 *
 *  The reported bug: on the native app, changing songs often started the new
 *  song at the PREVIOUS song's timestamp. The path was
 *      stream 403s -> native engine reports an error
 *      -> the player retries the track on web audio
 *      -> the retry reads the stored playhead, which still held the song before
 *  so the rule under test is: a stored position may only ever be applied to
 *  the track it was stored for.
 *
 *  Pure logic, so no server, browser or audio device is needed. */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// The helper is a tiny TypeScript module with no imports; strip the types
// rather than pulling a build step into the test suite.
const src = readFileSync(new URL('../apps/web/lib/playback/resumePosition.ts', import.meta.url), 'utf8');
const js = src
  .replace(/export interface ResumeInput \{[\s\S]*?\n\}/, '')
  .replace(/: ResumeInput\): number/, ')')
  .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*$/gm, '')
  .replace(/export function/, 'function')
  .replace(/requested = null,\n\}/, 'requested = null,\n}');
const { resumeStartAt } = await import(
  `data:text/javascript,${encodeURIComponent(`${js}\nexport { resumeStartAt };`)}`
);

const out = [];
const check = (name, fn) => {
  try {
    fn();
    out.push([name, true]);
    console.log(`PASS  ${name}`);
  } catch (e) {
    out.push([name, false]);
    console.log(`FAIL  ${name}  — ${e.message}`);
  }
};

check('a fresh track ignores another track’s stored position', () => {
  assert.equal(
    resumeStartAt({ trackId: 'song-b', positionOwnerId: 'song-a', storedPosition: 137, requested: null }),
    0,
  );
});

check('the reported bug: a 403 retry does not inherit the previous song', () => {
  // Song A played to 2:17, the user picked song B, B's stream 403'd and the
  // player retried B. B must start at 0, not 137.
  const retryStart = resumeStartAt({
    trackId: 'song-b',
    positionOwnerId: 'song-a',
    storedPosition: 137,
    requested: null,
  });
  assert.equal(retryStart, 0, `retry started at ${retryStart}`);
});

check('a retry of the SAME song keeps its place', () => {
  assert.equal(
    resumeStartAt({ trackId: 'song-b', positionOwnerId: 'song-b', storedPosition: 42, requested: null }),
    42,
  );
});

check('cold start resumes the persisted track', () => {
  assert.equal(
    resumeStartAt({ trackId: 'song-a', positionOwnerId: 'song-a', storedPosition: 11.3, requested: null }),
    11.3,
  );
});

check('an unknown owner never resumes', () => {
  assert.equal(resumeStartAt({ trackId: 'song-a', positionOwnerId: undefined, storedPosition: 90, requested: null }), 0);
  assert.equal(resumeStartAt({ trackId: 'song-a', positionOwnerId: null, storedPosition: 90, requested: null }), 0);
});

check('an explicit request wins, and is never negative', () => {
  assert.equal(resumeStartAt({ trackId: 'x', positionOwnerId: 'y', storedPosition: 5, requested: 30 }), 30);
  assert.equal(resumeStartAt({ trackId: 'x', positionOwnerId: 'x', storedPosition: 5, requested: 0 }), 0);
  assert.equal(resumeStartAt({ trackId: 'x', positionOwnerId: 'x', storedPosition: 5, requested: -9 }), 0);
});

check('nonsense stored values fall back to the start', () => {
  for (const bad of [NaN, Infinity, -4]) {
    assert.equal(resumeStartAt({ trackId: 'x', positionOwnerId: 'x', storedPosition: bad, requested: null }), 0);
  }
});

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
