import { describe, expect, it } from 'vitest';
import { createPresenceStore, parsePresence, presenceStore, PRESENCE_STALE_MS } from './presence';

const T0 = 1_000_000;
const report = (id = 't1', isPlaying = true) => ({
  track: { id, title: 'Song', artist: 'Band', durationSec: 200 }, position: 10, isPlaying, engine: 'web', appVersion: '0.5.0',
});

describe('presence store', () => {
  it('returns a fresh report and forgets it after 60 s', () => {
    const s = createPresenceStore();
    s.record('u1', report(), T0);
    expect(s.get('u1', T0 + PRESENCE_STALE_MS)?.track?.title).toBe('Song');
    expect(s.get('u1', T0 + PRESENCE_STALE_MS + 1)).toBeNull();
    expect(s.last('u1')?.at).toBe(T0);
    expect(s.get('nobody', T0)).toBeNull();
  });

  it('keeps "since" while the same track keeps reporting, resets it on a new one', () => {
    const s = createPresenceStore();
    s.record('u1', report('t1'), T0);
    expect(s.record('u1', report('t1'), T0 + 20_000).since).toBe(T0);
    expect(s.record('u1', report('t2'), T0 + 40_000).since).toBe(T0 + 40_000);
  });

  it('restarts "since" after a gap longer than the stale window', () => {
    const s = createPresenceStore();
    s.record('u1', report('t1'), T0);
    expect(s.record('u1', report('t1'), T0 + PRESENCE_STALE_MS + 5).since).toBe(T0 + PRESENCE_STALE_MS + 5);
  });

  it('shares one process-wide store', () => {
    expect(presenceStore()).toBe(presenceStore());
  });
});

describe('parsePresence', () => {
  it('accepts a heartbeat and trims it to what the admin page needs', () => {
    const p = parsePresence({ ...report(), track: { ...report().track, streamUrl: '/x', album: 'A' } });
    expect(p).toEqual(report());
  });

  it('treats no track as not playing', () => {
    expect(parsePresence({ track: null, isPlaying: true, position: 3 })).toMatchObject({ track: null, isPlaying: false, engine: 'web' });
  });

  it('rejects garbage', () => {
    expect(parsePresence(null)).toBeNull();
    expect(parsePresence({ track: { id: 5 } })).toBeNull();
  });

  it('clamps numbers and lengths', () => {
    const p = parsePresence({ ...report(), position: -5, engine: 'x'.repeat(99) });
    expect(p?.position).toBe(0);
    expect(p?.engine).toHaveLength(20);
  });
});
