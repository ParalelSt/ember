import { describe, expect, it } from 'vitest';
import { groupForDigest, formatDigest } from './digest';
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

const SINCE = 1_000_000;

describe('groupForDigest', () => {
  it('returns an empty array for empty input', () => {
    expect(groupForDigest([], SINCE)).toEqual([]);
  });

  it('excludes entries at or before sinceMs', () => {
    const entries = [serverEntry({ ts: SINCE }), serverEntry({ ts: SINCE - 1 })];
    expect(groupForDigest(entries, SINCE)).toEqual([]);
  });

  it('groups entries sharing a fingerprint and counts them', () => {
    const a = serverEntry({ ts: SINCE + 1000, message: 'yt-dlp exit 1 (attempt 2)' });
    const b = serverEntry({ ts: SINCE + 2000, message: 'yt-dlp exit 1 (attempt 5)' });
    const [group] = groupForDigest([a, b], SINCE);
    expect(group.count).toBe(2);
    expect(group.fingerprint).toBe(fingerprint(a));
    expect(group.firstSeen).toBe(SINCE + 1000);
    expect(group.lastSeen).toBe(SINCE + 2000);
    // Most recent occurrence is the example.
    expect(group.example).toBe(b);
  });

  it('sorts by count descending, then lastSeen descending', () => {
    const rare = serverEntry({ ts: SINCE + 9000, route: '/api/rare', message: 'rare' });
    const frequentA = serverEntry({ ts: SINCE + 1000, route: '/api/frequent', message: 'frequent' });
    const frequentB = serverEntry({ ts: SINCE + 5000, route: '/api/frequent', message: 'frequent' });
    const groups = groupForDigest([rare, frequentA, frequentB], SINCE);
    expect(groups.map((g) => g.route)).toEqual(['/api/frequent', '/api/rare']);
  });

  it('escalates a group to error level if any occurrence was an error, even if most are warnings', () => {
    const warn1 = serverEntry({ ts: SINCE + 1000, level: 'warn', message: 'upstream 502' });
    const warn2 = serverEntry({ ts: SINCE + 2000, level: 'warn', message: 'upstream 502' });
    const err = serverEntry({ ts: SINCE + 3000, level: 'error', message: 'upstream 502' });
    const [group] = groupForDigest([warn1, warn2, err], SINCE);
    expect(group.level).toBe('error');
    expect(group.count).toBe(3);
  });

  it('excludes info-level entries entirely, even alongside errors that would otherwise share a fingerprint', () => {
    const info = serverEntry({ ts: SINCE + 1000, level: 'info', message: 'password-reset' });
    expect(groupForDigest([info], SINCE)).toEqual([]);
  });

  it('does not let an info entry inflate an error group it happens to share a fingerprint with', () => {
    const info = serverEntry({ ts: SINCE + 1000, level: 'info', message: 'same message' });
    const err = serverEntry({ ts: SINCE + 2000, level: 'error', message: 'same message' });
    const [group] = groupForDigest([info, err], SINCE);
    expect(group.count).toBe(1);
  });

  it('keeps distinct fingerprints as separate groups', () => {
    const a = serverEntry({ route: '/api/a', ts: SINCE + 1000 });
    const b = serverEntry({ route: '/api/b', ts: SINCE + 1000 });
    expect(groupForDigest([a, b], SINCE)).toHaveLength(2);
  });
});

describe('formatDigest', () => {
  const since = Date.UTC(2026, 0, 1, 8, 12);
  const until = Date.UTC(2026, 0, 1, 19, 40);

  it('reports no errors for an empty group list', () => {
    const text = formatDigest([], { since, until });
    expect(text).toContain('(no errors)');
  });

  it('renders one line per group with count, route, status, times and an example message', () => {
    const example = serverEntry({
      ts: Date.UTC(2026, 0, 1, 19, 40),
      route: '/api/youtube/stream',
      category: 'api',
      message: 'yt-dlp exit 1',
      data: { status: 502 },
    });
    const groups = groupForDigest(
      [serverEntry({ ...example, ts: Date.UTC(2026, 0, 1, 8, 12) }), example],
      since - 1,
    );
    const text = formatDigest(groups, { since, until });
    const line = text.split('\n').find((l) => l.startsWith('2x'));
    expect(line).toBeDefined();
    expect(line).toContain('api');
    expect(line).toContain('/api/youtube/stream -> 502');
    expect(line).toContain('first 08:12');
    expect(line).toContain('last 19:40');
    expect(line).toContain('e.g. yt-dlp exit 1');
  });

  it('falls back to category as the target when a group has no route', () => {
    const groups = groupForDigest([serverEntry({ route: '', category: 'auth', message: 'session expired', ts: since + 1000 })], since);
    const line = formatDigest(groups, { since, until }).split('\n')[1];
    // Category column, then (with no route) category again as the target.
    expect(line).toContain('1x  auth  auth  first');
  });
});
