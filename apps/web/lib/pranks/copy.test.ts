import { describe, expect, it } from 'vitest';
import { agoWords, capWords, engineWords, logLine, personName, presenceLine, reasonWords, statusWords } from './copy';
import type { Presence } from './presence';

const NOW = Date.UTC(2026, 8, 23, 20, 0, 0);
const presence = (over: Partial<Presence> = {}): Presence => ({
  track: { id: 'youtube:abc123', title: 'Song X', artist: 'Band Y', durationSec: 225 },
  position: 83,
  isPlaying: true,
  engine: 'android',
  appVersion: '0.5.0',
  at: NOW,
  since: NOW - 4 * 60_000,
  ...over,
});

describe('presenceLine', () => {
  it('says what is playing, where in the song, since when and on what', () => {
    expect(presenceLine(presence(), null, null, NOW))
      .toBe('Playing “Song X” by Band Y, 1:23 of 3:45, since 4 min ago, on Android');
  });

  it('counts on from a heartbeat that is a few seconds old', () => {
    expect(presenceLine(presence({ at: NOW - 10_000 }), null, null, NOW)).toContain('1:33 of 3:45');
  });

  it('leaves out "since" for a song that just started', () => {
    expect(presenceLine(presence({ since: NOW - 5_000, engine: 'tauri-native' }), null, null, NOW))
      .toBe('Playing “Song X” by Band Y, 1:23 of 3:45, on desktop');
  });

  it('says paused', () => {
    expect(presenceLine(presence({ isPlaying: false, engine: 'web' }), null, null, NOW))
      .toBe('Paused on “Song X” by Band Y, in the browser');
  });

  it('falls back to the newest play, then to last seen', () => {
    expect(presenceLine(null, null, { title: 'Old', artist: 'Z', playedAt: NOW - 12 * 60_000 }, NOW))
      .toBe('Was playing “Old” by Z, 12 min ago');
    expect(presenceLine(null, presence({ at: NOW - 12 * 60_000 }), null, NOW)).toBe('Not listening (last seen 12 min ago)');
    expect(presenceLine(null, null, null, NOW)).toBe('Not listening');
  });

  it('never shows an id', () => {
    expect(presenceLine(presence(), null, null, NOW)).not.toContain('abc123');
  });
});

describe('log words', () => {
  const base = { issuerName: 'Aron', targetName: 'Marko', kind: 'ping' as const, reason: '', engine: 'tauri-native', playedSec: null };

  it('reads as a sentence per status', () => {
    expect(logLine({ ...base, status: 'delivered' })).toBe('Aron pinged Marko: delivered on desktop');
    expect(logLine({ ...base, status: 'pending' })).toBe('Aron pinged Marko: waiting for their app');
    expect(logLine({ ...base, status: 'expired' })).toBe('Aron pinged Marko: not delivered: offline, paused, or app too old');
    expect(logLine({ ...base, kind: 'sound', status: 'skipped', reason: 'not-playing' }))
      .toBe('Aron played a sound for Marko: not played: nothing was playing');
    expect(logLine({ ...base, kind: 'swap', status: 'done', playedSec: 19.6 })).toBe('Aron swapped the song for Marko: done after 20 s');
  });

  it('has words for every reason, and a readable fallback', () => {
    expect(reasonWords('paused')).toBe('their music was paused');
    expect(reasonWords('engine-unsupported')).toBe('their app cannot do that yet');
    expect(reasonWords('error:decode')).toBe('something went wrong (decode)');
    expect(statusWords('cancelled', '', '', null)).toBe('cancelled');
  });

  it('names engines in words', () => {
    expect(engineWords('capacitor')).toBe('on Android (older app)');
    expect(engineWords('mystery')).toBe('');
  });
});

describe('small words', () => {
  it('ago', () => {
    expect(agoWords(10_000)).toBe('just now');
    expect(agoWords(3 * 60_000)).toBe('3 min ago');
    expect(agoWords(2 * 3_600_000)).toBe('2 h ago');
  });
  it('caps', () => {
    expect(capWords('sound-gap', 'Marko', 5)).toBe('Sounds need 15 s between them; try again in 5 s');
    expect(capWords('target-hourly', 'Marko', 600)).toBe('Marko has had 20 pranks this hour; try again in 10 min');
  });
  it('names people by name or email, never id', () => {
    expect(personName({ name: ' Marko ', email: 'm@x.y' })).toBe('Marko');
    expect(personName({ name: '', email: 'marko@x.y' })).toBe('marko');
    expect(personName({})).toBe('someone');
  });
});
