import { describe, expect, it } from 'vitest';
import { historyFor } from './history';
import { fingerprint } from './fingerprint';
import type { ServerLogEntry } from '../logger/types';

function serverEntry(overrides: Partial<ServerLogEntry> = {}): ServerLogEntry {
  return {
    ts: Date.now(),
    kind: 'error',
    level: 'error',
    category: 'api',
    message: 'yt-dlp exit 1',
    sessionId: 'server',
    side: 'server',
    reqId: 'req-1',
    route: '/api/youtube/stream',
    ...overrides,
  };
}

describe('historyFor', () => {
  it('computes history for multiple fingerprints in one pass', () => {
    const a = serverEntry({ ts: 1000, route: '/api/a', message: 'boom a' });
    const b = serverEntry({ ts: 2000, route: '/api/b', message: 'boom b' });
    const b2 = serverEntry({ ts: 4000, route: '/api/b', message: 'boom b' });
    const fpA = fingerprint(a);
    const fpB = fingerprint(b);

    const result = historyFor([a, b, b2], [fpA, fpB]);
    expect(result.get(fpA)).toEqual({ count: 1, firstSeen: 1000, lastSeen: 1000 });
    expect(result.get(fpB)).toEqual({ count: 2, firstSeen: 2000, lastSeen: 4000 });
  });

  it('includes zero-count entries for fingerprints not present in the log', () => {
    const result = historyFor([], ['missing-fp']);
    expect(result.get('missing-fp')).toEqual({ count: 0, firstSeen: null, lastSeen: null });
  });

  it('handles an empty fingerprint list', () => {
    expect(historyFor([serverEntry()], [])).toEqual(new Map());
  });
});
