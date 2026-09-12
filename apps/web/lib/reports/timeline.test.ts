import { describe, expect, it } from 'vitest';
import { buildTimeline, formatTimeline, extractStatus } from './timeline';
import type { LogEntry, ServerLogEntry } from '../logger/types';

const REPORTED_AT = 1_000_000;

function clientEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    ts: REPORTED_AT - 5000,
    kind: 'breadcrumb',
    level: 'info',
    category: 'playback',
    message: 'play',
    sessionId: 'session-1',
    ...overrides,
  };
}

function serverEntry(overrides: Partial<ServerLogEntry> = {}): ServerLogEntry {
  return {
    ts: REPORTED_AT - 3000,
    kind: 'error',
    level: 'error',
    category: 'api',
    message: 'yt-dlp exit 1',
    sessionId: 'server',
    side: 'server',
    reqId: 'req-abcdefgh',
    route: '/api/youtube/stream/abc',
    ...overrides,
  };
}

describe('buildTimeline', () => {
  it('returns an empty array for empty input', () => {
    expect(buildTimeline({ client: [], server: [], reportedAt: REPORTED_AT })).toEqual([]);
  });

  it('renders relative times as negative ms-since-reportedAt', () => {
    const [line] = buildTimeline({ client: [clientEntry()], server: [], reportedAt: REPORTED_AT });
    expect(line.t).toBe(-5000);
  });

  it('orders lines chronologically across client and server', () => {
    const early = clientEntry({ ts: REPORTED_AT - 9000, message: 'early' });
    const late = serverEntry({ ts: REPORTED_AT - 1000, message: 'late', reqId: undefined });
    const lines = buildTimeline({ client: [early], server: [late], reportedAt: REPORTED_AT });
    expect(lines.map((l) => l.text.split('\n')[0])).toEqual(['early [playback]', '/api/youtube/stream/abc: late']);
  });

  it('caps output at maxLines, keeping the most recent', () => {
    const client = Array.from({ length: 30 }, (_, i) =>
      clientEntry({ ts: REPORTED_AT - (30 - i) * 1000, message: `msg ${i}` }),
    );
    const lines = buildTimeline({ client, server: [], reportedAt: REPORTED_AT, maxLines: 5 });
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => l.text)).toEqual(
      ['msg 25', 'msg 26', 'msg 27', 'msg 28', 'msg 29'].map((m) => `${m} [playback]`),
    );
  });

  it('keeps at least keepErrors error lines, dropping breadcrumbs first, when trimming to maxLines', () => {
    // 3 errors scattered among 20 breadcrumbs; maxLines is small enough that
    // a naive "keep the most recent N" would drop the oldest error.
    const breadcrumbs = Array.from({ length: 20 }, (_, i) =>
      clientEntry({ ts: REPORTED_AT - (23 - i) * 1000, message: `crumb ${i}` }),
    );
    const errors = [0, 10, 19].map((i) =>
      clientEntry({ ts: REPORTED_AT - (23 - i) * 1000 - 500, level: 'error', message: `err ${i}` }),
    );
    const lines = buildTimeline({
      client: [...breadcrumbs, ...errors],
      server: [],
      reportedAt: REPORTED_AT,
      maxLines: 5,
      keepErrors: 3,
    });
    const errorLines = lines.filter((l) => l.level === 'error');
    expect(errorLines).toHaveLength(3);
    expect(errorLines.map((l) => l.text)).toEqual(['err 0 [playback]', 'err 10 [playback]', 'err 19 [playback]']);
  });

  it('keepErrors never drops an error to make room for a breadcrumb that fits within maxLines', () => {
    const breadcrumbs = Array.from({ length: 2 }, (_, i) =>
      clientEntry({ ts: REPORTED_AT - (10 - i) * 1000, message: `crumb ${i}` }),
    );
    const errors = Array.from({ length: 8 }, (_, i) =>
      clientEntry({ ts: REPORTED_AT - (8 - i) * 100, level: 'error', message: `err ${i}` }),
    );
    const lines = buildTimeline({
      client: [...breadcrumbs, ...errors],
      server: [],
      reportedAt: REPORTED_AT,
      maxLines: 5,
      keepErrors: 8,
    });
    // All 8 errors kept even though maxLines is 5: keepErrors is a floor.
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(8);
    expect(lines.filter((l) => l.level !== 'error')).toHaveLength(0);
  });

  it('defaults maxLines to 25', () => {
    const client = Array.from({ length: 40 }, (_, i) => clientEntry({ ts: REPORTED_AT - (40 - i) * 1000 }));
    const lines = buildTimeline({ client, server: [], reportedAt: REPORTED_AT });
    expect(lines).toHaveLength(25);
  });

  it('picks up a reqId from a client entry data field, and from a server entry field', () => {
    const client = clientEntry({ category: 'api', data: { reqId: 'req-xyz' } });
    const server = serverEntry({ reqId: 'req-abc' });
    const lines = buildTimeline({ client: [client], server: [server], reportedAt: REPORTED_AT });
    expect(lines.map((l) => l.reqId)).toEqual(['req-xyz', 'req-abc']);
  });

  it('trims a stack trace to the first frame inside the repo', () => {
    const stack = [
      'Error: boom',
      '    at node_modules/some-lib/index.js:1:1',
      '    at Object.<anonymous> (apps/web/lib/reports/timeline.ts:42:10)',
      '    at internal/modules/cjs/loader.js:999:1',
    ].join('\n');
    const [line] = buildTimeline({ client: [clientEntry({ stack, level: 'error' })], server: [], reportedAt: REPORTED_AT });
    expect(line.text).toContain('apps/web/lib/reports/timeline.ts:42:10');
    expect(line.text).not.toContain('node_modules');
    // Only one frame line kept, not the whole stack.
    expect(line.text.split('\n')).toHaveLength(2);
  });

  it('falls back to the first stack line when no frame mentions the repo', () => {
    const stack = 'Error: boom\n    at somewhere/else.js:1:1';
    const [line] = buildTimeline({ client: [clientEntry({ stack })], server: [], reportedAt: REPORTED_AT });
    expect(line.text).toContain('somewhere/else.js:1:1');
  });

  it('does not mistake a package named "*-app" for an in-repo frame', () => {
    // The old unanchored /app\// regex matched inside "some-app/", a
    // dependency name, not our app/ directory. Anchored to a leading "/"
    // (or start of line) so only a real app/ path segment counts.
    const stack = [
      'Error: boom',
      '    at node_modules/some-app/index.js:1:1',
      '    at internal/modules/cjs/loader.js:999:1',
    ].join('\n');
    const [line] = buildTimeline({ client: [clientEntry({ stack, level: 'error' })], server: [], reportedAt: REPORTED_AT });
    // No frame qualifies as in-repo, so it falls back to the first stack line.
    expect(line.text).toContain('node_modules/some-app/index.js:1:1');
  });

  it('matches an in-repo "app/" frame at the very start of the line', () => {
    const stack = ['Error: boom', 'app/api/bug-report/route.ts:10:1', '    at node_modules/x/index.js:1:1'].join('\n');
    const [line] = buildTimeline({ client: [clientEntry({ stack, level: 'error' })], server: [], reportedAt: REPORTED_AT });
    expect(line.text).toContain('app/api/bug-report/route.ts:10:1');
  });

  it('appends capped extra data on error lines, dropping status and reqId keys', () => {
    const entry = clientEntry({
      level: 'error',
      category: 'api',
      message: 'stream failed',
      data: { status: 502, reqId: 'req-abc', helper: 'yt-dlp', exitCode: 1 },
    });
    const [line] = buildTimeline({ client: [entry], server: [], reportedAt: REPORTED_AT });
    expect(line.text).toContain('stream failed [api]');
    expect(line.text).toContain('"helper":"yt-dlp"');
    expect(line.text).toContain('"exitCode":1');
    expect(line.text).not.toContain('"status"');
    expect(line.text).not.toContain('"reqId"');
  });

  it('omits the data suffix entirely once status and reqId are stripped and nothing else remains', () => {
    const entry = clientEntry({ level: 'error', message: 'boom', data: { status: 502, reqId: 'req-abc' } });
    const [line] = buildTimeline({ client: [entry], server: [], reportedAt: REPORTED_AT });
    expect(line.text).toBe('boom [playback]');
  });

  it('never appends a data suffix on a non-error line, even when data is present', () => {
    const entry = clientEntry({ level: 'info', data: { extra: 'x' } });
    const [line] = buildTimeline({ client: [entry], server: [], reportedAt: REPORTED_AT });
    expect(line.text).not.toContain('extra');
  });

  it('clips a long data suffix to 150 chars', () => {
    const entry = clientEntry({ level: 'error', message: 'boom', data: { blob: 'x'.repeat(500) } });
    const [line] = buildTimeline({ client: [entry], server: [], reportedAt: REPORTED_AT });
    const suffix = line.text.slice(line.text.indexOf('{'));
    // 150 chars of clipped JSON plus the ellipsis character clip() appends.
    expect(suffix.length).toBeLessThanOrEqual(151);
    expect(suffix.endsWith('…')).toBe(true);
  });

  it('also appends a data suffix on a server error line', () => {
    const entry = serverEntry({ data: { helper: 'yt-dlp' } });
    const [line] = buildTimeline({ client: [], server: [entry], reportedAt: REPORTED_AT });
    expect(line.text).toContain('"helper":"yt-dlp"');
  });

  it('includes native:* entries tagged with their category', () => {
    const [line] = buildTimeline({
      client: [clientEntry({ category: 'native:offline', message: 'pin failed' })],
      server: [],
      reportedAt: REPORTED_AT,
    });
    expect(line.text).toBe('pin failed [native:offline]');
  });
});

describe('extractStatus', () => {
  it('reads a numeric status field out of a data blob', () => {
    expect(extractStatus({ status: 502 })).toBe(502);
  });

  it('returns undefined when absent or not a number', () => {
    expect(extractStatus(undefined)).toBeUndefined();
    expect(extractStatus({ status: '502' })).toBeUndefined();
    expect(extractStatus(null)).toBeUndefined();
  });
});

describe('formatTimeline', () => {
  it('renders a placeholder for empty input', () => {
    expect(formatTimeline([])).toBe('(no timeline)');
  });

  it('pairs a client api error with the server entry sharing its reqId, indented underneath', () => {
    const client = clientEntry({
      category: 'api',
      level: 'error',
      message: 'GET /api/youtube/stream/abc failed',
      reqId: undefined,
      data: { reqId: 'req-abcdefgh' },
    } as Partial<LogEntry>);
    const server = serverEntry({ reqId: 'req-abcdefgh', message: 'yt-dlp exit 1' });
    const lines = buildTimeline({ client: [client], server: [server], reportedAt: REPORTED_AT });
    const text = formatTimeline(lines);
    const rendered = text.split('\n');
    const clientIdx = rendered.findIndex((l) => l.includes('GET /api/youtube/stream/abc failed'));
    expect(clientIdx).toBeGreaterThanOrEqual(0);
    expect(rendered[clientIdx + 1]).toBe('        server: /api/youtube/stream/abc: yt-dlp exit 1');
    // The paired server line must not also appear as a standalone top-level entry.
    expect(rendered.filter((l) => l.includes('yt-dlp exit 1'))).toHaveLength(1);
  });

  it('lists errors first in their own block, then breadcrumbs under "Before it"', () => {
    const breadcrumb = clientEntry({ ts: REPORTED_AT - 9000, level: 'info', message: 'breadcrumb' });
    const error = clientEntry({ ts: REPORTED_AT - 1000, level: 'error', message: 'boom' });
    const lines = buildTimeline({ client: [breadcrumb, error], server: [], reportedAt: REPORTED_AT });
    const text = formatTimeline(lines);
    const errorsIdx = text.indexOf('Errors');
    const beforeIdx = text.indexOf('Before it');
    const boomIdx = text.indexOf('boom');
    const breadcrumbIdx = text.indexOf('breadcrumb');
    expect(errorsIdx).toBeGreaterThanOrEqual(0);
    expect(beforeIdx).toBeGreaterThan(errorsIdx);
    expect(boomIdx).toBeLessThan(beforeIdx);
    expect(breadcrumbIdx).toBeGreaterThan(beforeIdx);
  });

  it('omits the "Before it" block when there are no non-error lines', () => {
    const error = clientEntry({ level: 'error', message: 'boom' });
    const lines = buildTimeline({ client: [error], server: [], reportedAt: REPORTED_AT });
    expect(formatTimeline(lines)).not.toContain('Before it');
  });

  it('omits the "Errors" block when there are no error lines', () => {
    const breadcrumb = clientEntry({ level: 'info', message: 'breadcrumb' });
    const lines = buildTimeline({ client: [breadcrumb], server: [], reportedAt: REPORTED_AT });
    expect(formatTimeline(lines)).not.toContain('Errors');
  });

  it('shows a relative time and reqId tag on a standalone line', () => {
    const server = serverEntry({ reqId: 'req-abcdefgh' });
    const lines = buildTimeline({ client: [], server: [server], reportedAt: REPORTED_AT });
    const text = formatTimeline(lines);
    expect(text).toContain('-3.0s');
    expect(text).toContain('reqId req-abcd');
  });
});
