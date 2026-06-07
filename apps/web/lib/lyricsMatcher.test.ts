import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankLrclibHits, type RankableHit } from './lyricsMatcher.ts';

const baseHit = (overrides: Partial<RankableHit> = {}): RankableHit => ({
  id: 1,
  duration: 200,
  syncedLyrics: '[00:00.00]hi\n',
  plainLyrics: 'hi',
  instrumental: false,
  fromStageA: false,
  ...overrides,
});

test('rankLrclibHits prefers synced over plain regardless of duration', () => {
  const plainCloser = baseHit({ id: 1, duration: 200, syncedLyrics: null });
  const syncedFarther = baseHit({ id: 2, duration: 250 });
  const best = rankLrclibHits([plainCloser, syncedFarther], 200);
  assert.equal(best?.id, 2);
});

test('rankLrclibHits drops instrumentals', () => {
  const inst = baseHit({ id: 1, instrumental: true });
  const real = baseHit({ id: 2 });
  const best = rankLrclibHits([inst, real], 200);
  assert.equal(best?.id, 2);
});

test('rankLrclibHits picks closest duration among synced hits', () => {
  const a = baseHit({ id: 1, duration: 210 });
  const b = baseHit({ id: 2, duration: 195 });
  const c = baseHit({ id: 3, duration: 250 });
  const best = rankLrclibHits([a, b, c], 200);
  assert.equal(best?.id, 2);
});

test('rankLrclibHits caps duration consideration at ±10s', () => {
  // 211 is within ±10s of 200; 250 is beyond. Both synced.
  const close = baseHit({ id: 1, duration: 211 });
  const far = baseHit({ id: 2, duration: 250 });
  const best = rankLrclibHits([close, far], 200);
  assert.equal(best?.id, 1);
});

test('rankLrclibHits filters hits beyond ±10s when something closer is available', () => {
  const tooFar = baseHit({ id: 1, duration: 250 });
  const close = baseHit({ id: 2, duration: 205 });
  const best = rankLrclibHits([tooFar, close], 200);
  assert.equal(best?.id, 2);
});

test('rankLrclibHits returns null when all hits are instrumental', () => {
  const inst1 = baseHit({ id: 1, instrumental: true });
  const inst2 = baseHit({ id: 2, instrumental: true });
  assert.equal(rankLrclibHits([inst1, inst2], 200), null);
});

test('rankLrclibHits tie-breaks on stage-A flag', () => {
  const b = baseHit({ id: 1, duration: 200, fromStageA: false });
  const a = baseHit({ id: 2, duration: 200, fromStageA: true });
  const best = rankLrclibHits([b, a], 200);
  assert.equal(best?.id, 2);
});

test('rankLrclibHits treats null duration as Infinity delta', () => {
  const noDur = baseHit({ id: 1, duration: null });
  const known = baseHit({ id: 2, duration: 210 });
  const best = rankLrclibHits([noDur, known], 200);
  assert.equal(best?.id, 2);
});

test('rankLrclibHits with ourDurationSec=0 still returns the best synced hit', () => {
  // No duration info from us → skip criterion 3, fall back to first synced.
  const a = baseHit({ id: 1, duration: 999 });
  const b = baseHit({ id: 2, duration: 200, syncedLyrics: null });
  const best = rankLrclibHits([a, b], 0);
  assert.equal(best?.id, 1);
});

test('rankLrclibHits returns null for empty input', () => {
  assert.equal(rankLrclibHits([], 200), null);
});

test('rankLrclibHits picks plain hit when no synced exists', () => {
  const a = baseHit({ id: 1, syncedLyrics: null, plainLyrics: 'hi', duration: 210 });
  const b = baseHit({ id: 2, syncedLyrics: null, plainLyrics: 'hi', duration: 200 });
  const best = rankLrclibHits([a, b], 200);
  assert.equal(best?.id, 2);
});
