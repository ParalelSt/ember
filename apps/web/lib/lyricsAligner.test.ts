import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFirstNonSilenceSec, computeOffset } from './lyricsAligner.ts';

// Build a Float32Array: N seconds of silence, then a constant 0.5-amplitude signal.
function buildBuffer(silenceSec: number, totalSec: number, sampleRate: number, amplitude = 0.5) {
  const total = Math.round(totalSec * sampleRate);
  const silentSamples = Math.round(silenceSec * sampleRate);
  const buf = new Float32Array(total);
  for (let i = silentSamples; i < total; i++) buf[i] = amplitude;
  return buf;
}

test('findFirstNonSilenceSec returns ~silenceSec for clean leading silence', () => {
  const sr = 44100;
  const buf = buildBuffer(2.0, 5.0, sr);
  const t = findFirstNonSilenceSec(buf, sr);
  // 100ms window granularity → may report 2.0 or 2.1.
  assert.ok(t >= 1.9 && t <= 2.1, `expected ~2.0, got ${t}`);
});

test('findFirstNonSilenceSec returns 0 for buffer that starts loud', () => {
  const sr = 44100;
  const buf = buildBuffer(0, 3.0, sr);
  assert.equal(findFirstNonSilenceSec(buf, sr), 0);
});

test('findFirstNonSilenceSec returns 0 for fully silent buffer (no detectable content)', () => {
  const sr = 44100;
  const buf = new Float32Array(sr * 3);
  // When nothing crosses threshold, we return 0 (no silence detected →
  // act as if audio starts immediately, the safety rail in computeOffset
  // then forces offset=0).
  assert.equal(findFirstNonSilenceSec(buf, sr), 0);
});

test('computeOffset clamps to ±5s', () => {
  assert.equal(computeOffset(100, 0), 5);
  // tAudio is well above the no-intro threshold; tLrcFirst is huge, so
  // the raw delta is a large negative number and the clamp at -5 kicks in.
  assert.equal(computeOffset(2, 100), -5);
  assert.equal(computeOffset(3, 1), 2);
});

test('computeOffset no-intro guard wins over clamp (huge LRC start time, no audio intro)', () => {
  // tAudio < 0.5 → guard fires immediately and we trust the LRC,
  // even if the raw delta would clamp to -5.
  assert.equal(computeOffset(0, 100), 0);
  assert.equal(computeOffset(0.4, 50), 0);
});

test('computeOffset forces 0 when tAudio < 0.5s (no detectable leading silence)', () => {
  // Audio starts cold; trust the LRC's own first-line time.
  assert.equal(computeOffset(0, 0), 0);
  assert.equal(computeOffset(0.3, 5), 0);
});

test('computeOffset returns positive offset when audio intro is longer than LRC expects', () => {
  // LRC starts at t=0; audio intro is 4.2s → highlight should fire 4.2s later.
  assert.equal(computeOffset(4.2, 0), 4.2);
});
