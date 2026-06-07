import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readOffset, writeOffset, _setStorageForTests } from './lyricsOffsetCache.ts';

class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

let store: MemStorage;
beforeEach(() => {
  store = new MemStorage();
  _setStorageForTests(store);
});

test('writeOffset then readOffset returns the offset', () => {
  writeOffset('youtube:abc', 'hash123', 2.5);
  assert.equal(readOffset('youtube:abc', 'hash123'), 2.5);
});

test('readOffset returns null when no entry exists', () => {
  assert.equal(readOffset('youtube:abc', 'hashx'), null);
});

test('readOffset returns null when lrcHash mismatches (LRC has changed)', () => {
  writeOffset('youtube:abc', 'hash123', 2.5);
  assert.equal(readOffset('youtube:abc', 'hashDIFFERENT'), null);
});

test('readOffset returns null when entry is older than 30 days', () => {
  // Write an entry with a forged computedAt 31 days in the past.
  store.setItem(
    'ember.lyrics.offset.v1.youtube:abc',
    JSON.stringify({ offset: 1.0, computedAt: Date.now() - 31 * 24 * 3600 * 1000, lrcHash: 'h' }),
  );
  assert.equal(readOffset('youtube:abc', 'h'), null);
});

test('readOffset returns the offset when entry is fresh', () => {
  store.setItem(
    'ember.lyrics.offset.v1.youtube:abc',
    JSON.stringify({ offset: 1.0, computedAt: Date.now() - 24 * 3600 * 1000, lrcHash: 'h' }),
  );
  assert.equal(readOffset('youtube:abc', 'h'), 1.0);
});

test('readOffset survives malformed JSON gracefully', () => {
  store.setItem('ember.lyrics.offset.v1.youtube:abc', 'not-json');
  assert.equal(readOffset('youtube:abc', 'h'), null);
});
