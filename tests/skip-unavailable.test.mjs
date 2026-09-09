/** Skipping unavailable tracks during playback — Task 3.
 *
 *      node tests/skip-unavailable.test.mjs   # or: npm run test:skip
 *
 *  Pure logic — no server, browser or audio device. Mirrors the loader
 *  pattern in tests/duration.test.mjs: read the source, strip TS-only
 *  syntax, import as a data: URL. */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../apps/web/lib/playback/skipUnavailable.ts', import.meta.url), 'utf8');
const js = src
  .replace(/^import type .*$/m, '')
  .replace(
    /export function isUnavailable\(track: Pick<Track, 'unavailableAt'> \| null \| undefined\): boolean/,
    'export function isUnavailable(track)',
  )
  .replace(
    /export function nextPlayable\([\s\S]*?\): \{ index: number; skipped: Track\[\] \}/,
    'export function nextPlayable(queue, start, step, wrap)',
  )
  .replace(/const skipped: Track\[\] = \[\];/, 'const skipped = [];')
  .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*$/gm, '');
const { isUnavailable, nextPlayable } = await import(
  `data:text/javascript,${encodeURIComponent(js)}`
);

const out = [];
const check = (name, fn) => {
  try { fn(); out.push([name, true]); console.log(`PASS  ${name}`); }
  catch (e) { out.push([name, false]); console.log(`FAIL  ${name}  — ${e.message}`); }
};

/** Minimal track builder: id + whether it's unavailable. */
const t = (id, dead) => ({ id, unavailableAt: dead ? '2026-09-09T00:00:00.000Z' : null });

check('isUnavailable: true for a string, false for null/undefined/empty', () => {
  assert.equal(isUnavailable({ unavailableAt: '2026-09-09T00:00:00.000Z' }), true);
  assert.equal(isUnavailable({ unavailableAt: null }), false);
  assert.equal(isUnavailable({ unavailableAt: undefined }), false);
  assert.equal(isUnavailable({ unavailableAt: '' }), false);
});

check('nextPlayable: start already playable returns start, no skips', () => {
  const queue = [t('a', false), t('b', false)];
  const r = nextPlayable(queue, 0, 1, false);
  assert.equal(r.index, 0);
  assert.deepEqual(r.skipped, []);
});

check('nextPlayable: forward over two dead tracks', () => {
  const queue = [t('live0', false), t('dead1', true), t('dead2', true), t('live3', false)];
  const r = nextPlayable(queue, 1, 1, false);
  assert.equal(r.index, 3);
  assert.deepEqual(r.skipped.map((x) => x.id), ['dead1', 'dead2']);
});

check('nextPlayable: backward over two dead tracks', () => {
  const queue = [t('live0', false), t('dead1', true), t('dead2', true), t('live3', false)];
  const r = nextPlayable(queue, 2, -1, false);
  assert.equal(r.index, 0);
  assert.deepEqual(r.skipped.map((x) => x.id), ['dead2', 'dead1']);
});

check('nextPlayable: wrap does one lap and finds the far end; no wrap gives -1', () => {
  const queue = [t('dead0', true), t('live1', false), t('dead2', true)];
  const wrapped = nextPlayable(queue, 2, 1, true);
  assert.equal(wrapped.index, 1);
  const unwrapped = nextPlayable(queue, 2, 1, false);
  assert.equal(unwrapped.index, -1);
});

check('nextPlayable: all dead with wrap gives -1, each track skipped once', () => {
  const queue = [t('dead0', true), t('dead1', true), t('dead2', true)];
  const r = nextPlayable(queue, 0, 1, true);
  assert.equal(r.index, -1);
  assert.deepEqual(r.skipped.map((x) => x.id).sort(), ['dead0', 'dead1', 'dead2']);
  assert.equal(r.skipped.length, 3);
});

check('nextPlayable: start out of range with wrap false returns -1', () => {
  const queue = [t('a', false)];
  assert.equal(nextPlayable(queue, 5, 1, false).index, -1);
  assert.equal(nextPlayable(queue, -1, -1, false).index, -1);
});

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
