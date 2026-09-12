import { describe, expect, it } from 'vitest';
import { fingerprint, normalizeMessage } from './fingerprint';
import type { LogEntry, ServerLogEntry } from '../logger/types';

function serverEntry(overrides: Partial<ServerLogEntry> = {}): ServerLogEntry {
  return {
    ts: Date.now(),
    kind: 'error',
    level: 'error',
    category: 'api',
    message: 'stream failed',
    sessionId: 'server',
    side: 'server',
    reqId: 'req-1',
    route: '/api/youtube/stream',
    ...overrides,
  };
}

function clientEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    ts: Date.now(),
    kind: 'error',
    level: 'error',
    category: 'api',
    message: 'fetch failed',
    sessionId: 'session-1',
    ...overrides,
  };
}

describe('normalizeMessage', () => {
  it('strips digit runs', () => {
    expect(normalizeMessage('retried 3 times after 502')).toBe('retried # times after #');
  });

  it('strips PocketBase-style 15-char ids', () => {
    expect(normalizeMessage('record abc123def456ghi not found')).toBe('record # not found');
  });

  it('strips youtube ids after the youtube: tag but keeps the tag', () => {
    expect(normalizeMessage('play youtube:dQw4w9WgXcQ failed')).toBe('play youtube:# failed');
  });

  it('strips quoted strings', () => {
    expect(normalizeMessage('bad value "hello world" given')).toBe('bad value # given');
  });

  it('strips URL query strings but keeps the path', () => {
    expect(normalizeMessage('GET https://x.test/api/foo?token=abc&x=1 failed')).toBe('get https://x.test/api/foo failed');
  });

  it('strips long hex blobs', () => {
    expect(normalizeMessage('hash 9f8e7d6c5b4a3f2e1d0c9b8a mismatch')).toBe('hash # mismatch');
  });

  it('lower-cases and collapses whitespace', () => {
    expect(normalizeMessage('  Upstream   Error  ')).toBe('upstream error');
  });
});

describe('fingerprint', () => {
  it('is stable across repeated calls (deterministic, not time/random based)', () => {
    const e = serverEntry();
    expect(fingerprint(e)).toBe(fingerprint(e));
  });

  it('is an 8-character hex string', () => {
    expect(fingerprint(serverEntry())).toMatch(/^[0-9a-f]{8}$/);
  });

  it('treats two entries differing only in embedded ids/numbers as the same bug', () => {
    const a = serverEntry({ message: 'yt-dlp exit 1 for abc123def456ghi' });
    const b = serverEntry({ message: 'yt-dlp exit 1 for zzz999yyy888xxx' });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('treats two entries differing only in a retry count as the same bug', () => {
    const a = serverEntry({ message: 'retried 3 times' });
    const b = serverEntry({ message: 'retried 12 times' });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('treats different routes as different bugs even with the same message', () => {
    const a = serverEntry({ route: '/api/youtube/stream' });
    const b = serverEntry({ route: '/api/library/scan' });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('treats different categories as different bugs', () => {
    const a = serverEntry({ category: 'api' });
    const b = serverEntry({ category: 'auth' });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('treats client and server sides of an otherwise identical message as different bugs', () => {
    const server = serverEntry({ message: 'stream failed', category: 'api', route: '' });
    const client = clientEntry({ message: 'stream failed', category: 'api' });
    expect(fingerprint(server)).not.toBe(fingerprint(client));
  });

  it('a client entry has no route to key on, so two different client errors with the same message/category collide', () => {
    const a = clientEntry({ message: 'play failed' });
    const b = clientEntry({ message: 'play failed' });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});
