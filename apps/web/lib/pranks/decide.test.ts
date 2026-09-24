import { describe, expect, it } from 'vitest';
import { decidePrank, toPrankRow, type DecideContext } from './decide';
import { pbDate } from './limits';
import type { PrankRow } from './types';

const NOW = Date.UTC(2026, 8, 23, 20, 0, 0);
const ctx = (over: Partial<DecideContext> = {}): DecideContext => ({
  isPlaying: true, hasTrack: true, engine: 'web', busy: false,
  pluginHasOverlay: false, now: NOW, ...over,
});
const prank = (over: Partial<PrankRow> = {}): PrankRow => ({
  id: 'p1',
  kind: 'sound',
  params: { durationSec: 20, volume: 0.5, mode: 'duck', startFrom: 'start' },
  streamUrl: '/api/pranks/media/s1',
  expiresAt: pbDate(NOW + 30_000),
  ...over,
});

describe('decidePrank', () => {
  it('ignores a row past its expiry, even a ping', () => {
    expect(decidePrank(prank({ kind: 'ping', expiresAt: pbDate(NOW - 1) }), ctx())).toEqual({ type: 'ignore' });
    expect(decidePrank(prank({ expiresAt: '' }), ctx())).toEqual({ type: 'ignore' });
  });

  it('acks a ping whatever the player is doing', () => {
    expect(decidePrank(prank({ kind: 'ping', streamUrl: null }), ctx({ isPlaying: false, hasTrack: false })))
      .toEqual({ type: 'ack-only' });
  });

  it('plays a sound only while music plays', () => {
    expect(decidePrank(prank(), ctx())).toEqual({ type: 'sound', url: '/api/pranks/media/s1', volume: 0.5, duck: true });
    expect(decidePrank(prank(), ctx({ isPlaying: false }))).toEqual({ type: 'skip', reason: 'not-playing' });
    expect(decidePrank(prank(), ctx({ hasTrack: false }))).toEqual({ type: 'skip', reason: 'not-playing' });
  });

  it('skips when another prank is running', () => {
    expect(decidePrank(prank(), ctx({ busy: true }))).toEqual({ type: 'skip', reason: 'busy' });
  });

  it('says engine-unsupported where the engine cannot do it', () => {
    expect(decidePrank(prank(), ctx({ engine: 'android' }))).toEqual({ type: 'skip', reason: 'engine-unsupported' });
    expect(decidePrank(prank(), ctx({ engine: 'android', pluginHasOverlay: true }))).toMatchObject({ type: 'sound' });
    expect(decidePrank(prank(), ctx({ engine: 'native-stub' }))).toEqual({ type: 'skip', reason: 'engine-unsupported' });
  });

  it('skips a sound with no media', () => {
    expect(decidePrank(prank({ streamUrl: null }), ctx())).toEqual({ type: 'skip', reason: 'error:no-media' });
  });
});

describe('toPrankRow', () => {
  const record = {
    id: 'p1', kind: 'sound', status: 'pending', expires_at: '2026-09-23 20:00:30.000Z',
    params: { durationSec: 999, volume: 0.4, streamUrl: '/api/pranks/media/s1' }, target: 'u1', issued_by: 'a1',
  };

  it('maps a pending record, clamping its params', () => {
    expect(toPrankRow(record)).toEqual({
      id: 'p1', kind: 'sound', expiresAt: '2026-09-23 20:00:30.000Z', streamUrl: '/api/pranks/media/s1',
      params: { durationSec: 30, volume: 0.4, mode: 'over', startFrom: 'start' },
    });
  });

  it('refuses a non-pending row, an unknown kind, and an off-site media URL', () => {
    expect(toPrankRow({ ...record, status: 'done' })).toBeNull();
    expect(toPrankRow({ ...record, kind: 'explode' })).toBeNull();
    expect(toPrankRow({ ...record, params: { streamUrl: 'https://evil.example/a.mp3' } })?.streamUrl).toBeNull();
  });

  it('gives a ping no media', () => {
    expect(toPrankRow({ ...record, kind: 'ping' })?.streamUrl).toBeNull();
  });
});
