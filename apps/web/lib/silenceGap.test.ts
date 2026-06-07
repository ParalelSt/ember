import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideAdvance,
  MIN_DWELL_SEC,
  MIN_SILENCE_SEC,
  FALLBACK_SEC,
  SILENCE_THRESHOLD,
} from './silenceGap.ts';

test('decideAdvance does not advance during dwell window even with silence', () => {
  const r = decideAdvance({
    elapsedSec: 1,                       // < MIN_DWELL_SEC = 5
    rms: 0,                              // silent
    silenceStart: 12,                    // even with a prior run
    t: 15,
  });
  assert.equal(r.advance, false);
  // Dwell guard clears any pending silence run so spurious post-dwell
  // edges don't fire from a silence that started during dwell.
  assert.equal(r.nextSilenceStart, null);
});

test('decideAdvance does not advance during dwell window even with loud audio', () => {
  const r = decideAdvance({
    elapsedSec: 2,
    rms: 0.5,
    silenceStart: null,
    t: 20,
  });
  assert.equal(r.advance, false);
  assert.equal(r.nextSilenceStart, null);
});

test('decideAdvance after dwell, sustained loud audio: no advance, no silence run', () => {
  const r = decideAdvance({
    elapsedSec: 10,
    rms: 0.5,
    silenceStart: null,
    t: 30,
  });
  assert.equal(r.advance, false);
  assert.equal(r.nextSilenceStart, null);
});

test('decideAdvance starts a silence run when RMS drops below threshold', () => {
  const r = decideAdvance({
    elapsedSec: 10,
    rms: SILENCE_THRESHOLD / 2,          // clearly silent
    silenceStart: null,
    t: 30,
  });
  assert.equal(r.advance, false);
  assert.equal(r.nextSilenceStart, 30);
});

test('decideAdvance preserves an in-progress silence start', () => {
  const r = decideAdvance({
    elapsedSec: 10,
    rms: 0.001,                          // silent
    silenceStart: 28,                    // started 2s ago
    t: 30,
  });
  assert.equal(r.advance, false);
  assert.equal(r.nextSilenceStart, 28);  // unchanged
});

test('decideAdvance fires on rising edge after a real silence gap', () => {
  const r = decideAdvance({
    elapsedSec: 10,
    rms: 0.5,
    silenceStart: 28,                    // gapLen = 30 - 28 = 2 > MIN_SILENCE_SEC
    t: 30,
  });
  assert.equal(r.advance, true);
  assert.equal(r.nextSilenceStart, null);
});

test('decideAdvance does NOT fire on rising edge after a brief blip (< MIN_SILENCE_SEC)', () => {
  const r = decideAdvance({
    elapsedSec: 10,
    rms: 0.5,
    silenceStart: 29.9,                  // gapLen = 30 - 29.9 = 0.1 < MIN_SILENCE_SEC
    t: 30,
  });
  assert.equal(r.advance, false);
  assert.equal(r.nextSilenceStart, null);
});

test('decideAdvance fires fallback after FALLBACK_SEC of no silence', () => {
  const r = decideAdvance({
    elapsedSec: FALLBACK_SEC + 0.1,
    rms: 0.5,
    silenceStart: null,
    t: 100,
  });
  assert.equal(r.advance, true);
  assert.equal(r.nextSilenceStart, null);
});

test('decideAdvance does not double-fire when silence end and fallback both qualify', () => {
  // gap qualifies AND elapsed > FALLBACK_SEC — the silence-end edge
  // wins; advance returns true exactly once.
  const r = decideAdvance({
    elapsedSec: FALLBACK_SEC + 5,
    rms: 0.5,
    silenceStart: 90,                    // gapLen = 100 - 90 = 10
    t: 100,
  });
  assert.equal(r.advance, true);
  assert.equal(r.nextSilenceStart, null);
});

test('exported constants have the documented values', () => {
  assert.equal(SILENCE_THRESHOLD, 0.01);
  assert.equal(MIN_SILENCE_SEC, 0.3);
  assert.equal(MIN_DWELL_SEC, 5);
  assert.equal(FALLBACK_SEC, 45);
});

test('decideAdvance brief-blip exit does NOT fire fallback the same tick (fires next tick)', () => {
  // Brief blip ends (gapLen < MIN_SILENCE_SEC) while fallback timer
  // is also qualified. This tick returns no-advance to keep the
  // edge/fallback branches non-overlapping; the fallback will fire
  // on the next tick when silenceStart is null.
  const thisTick = decideAdvance({
    elapsedSec: FALLBACK_SEC + 5,
    rms: 0.5,
    silenceStart: 99.9,                // gapLen = 100 - 99.9 = 0.1 < MIN_SILENCE_SEC
    t: 100,
  });
  assert.equal(thisTick.advance, false);
  assert.equal(thisTick.nextSilenceStart, null);

  // Simulate the next tick: silenceStart is now null, fallback
  // still qualifies, loud audio — fallback fires.
  const nextTick = decideAdvance({
    elapsedSec: FALLBACK_SEC + 5.02,
    rms: 0.5,
    silenceStart: null,
    t: 100.02,
  });
  assert.equal(nextTick.advance, true);
  assert.equal(nextTick.nextSilenceStart, null);
});
