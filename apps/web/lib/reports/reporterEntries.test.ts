import { describe, expect, it } from 'vitest';
import type { ServerLogEntry } from '@/lib/logger/types';
import { entriesForReporter } from './reporterEntries';

function entry(over: Partial<ServerLogEntry>): ServerLogEntry {
  return {
    ts: 1,
    kind: 'error',
    level: 'error',
    category: 'api',
    message: 'GET lyrics -> 500',
    sessionId: 'server',
    side: 'server',
    reqId: 'r1',
    route: 'lyrics',
    ...over,
  };
}

describe('entriesForReporter', () => {
  const mine = entry({ userId: 'me', reqId: 'r-me', data: { videoId: 'myVideo' }, stack: 'Error: mine' });
  const theirs = entry({ userId: 'them', reqId: 'r-them', message: 'lyrics lookup failed for Their Song', data: { q: 'their search' } });
  const signedOut = entry({ reqId: 'r-anon', data: { videoId: 'castVideo' } });
  const serverWide = entry({ reqId: '', route: '', category: 'stream', message: 'cache warm gave up', data: { videoId: 'someonesVideo' }, stack: 'Error: yt-dlp failed for someonesVideo' });

  it("keeps the reporter's own entries whole", () => {
    expect(entriesForReporter([mine], 'me')).toEqual([mine]);
  });

  it("never carries another member's entry, nor one from a signed-out request", () => {
    const out = entriesForReporter([theirs, signedOut, mine], 'me');
    expect(out).toEqual([mine]);
    expect(JSON.stringify(out)).not.toMatch(/them|Their Song|their search|castVideo/);
  });

  it('keeps a server-wide entry as its bare message, without details or stack', () => {
    const [out] = entriesForReporter([serverWide], 'me');
    expect(out).toMatchObject({ category: 'stream', message: 'cache warm gave up', level: 'error', reqId: '' });
    expect(out.data).toBeUndefined();
    expect(out.stack).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('someonesVideo');
  });

  it('an unknown reporter id matches nothing of anyone', () => {
    expect(entriesForReporter([mine, theirs], '')).toEqual([]);
  });
});
