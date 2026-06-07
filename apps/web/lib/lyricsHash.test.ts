import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashLrc } from './lyricsHash.ts';

test('hashLrc returns same hash for identical lines', () => {
  const a = [{ time: 1.5, text: 'hi' }, { time: 2.5, text: 'there' }];
  const b = [{ time: 1.5, text: 'hi' }, { time: 2.5, text: 'there' }];
  assert.equal(hashLrc(a), hashLrc(b));
});

test('hashLrc returns different hash when timestamps differ', () => {
  const a = [{ time: 1.5, text: 'x' }];
  const b = [{ time: 1.6, text: 'x' }];
  assert.notEqual(hashLrc(a), hashLrc(b));
});

test('hashLrc rounds time to 2 decimal places (ignores micro variance)', () => {
  const a = [{ time: 1.501, text: 'x' }];
  const b = [{ time: 1.504, text: 'x' }];
  assert.equal(hashLrc(a), hashLrc(b));
});

test('hashLrc handles empty array', () => {
  assert.equal(typeof hashLrc([]), 'string');
});

test('hashLrc result is 8 characters', () => {
  const h = hashLrc([{ time: 0, text: 'x' }]);
  assert.equal(h.length, 8);
});
