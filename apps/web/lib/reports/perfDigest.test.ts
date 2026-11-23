import { describe, expect, it } from 'vitest';
import { buildPerfSection, heapSlopes, isPerfNativeEntry } from './perfDigest';
import type { StoredDigest } from '@/lib/perf/sessions';
import type { PerfDigest } from '@/lib/perf/types';
import type { ServerLogEntry } from '@/lib/logger/types';

/** The daily digest's performance section. */

function d(ts: number, userId: string, over: Partial<PerfDigest> = {}): StoredDigest {
  return { ts, userId, digest: { v: 1, session: 's1', seq: 1, t0: 1_700_000_000_000, app: '0.7.51', shell: 'capacitor', device: { model: 'motorola edge 60' }, fgMs: 300_000, ...over } };
}

function server(over: Partial<ServerLogEntry>): ServerLogEntry {
  return { ts: 1, kind: 'error', level: 'info', category: 'perf', message: 'server timing', sessionId: 'server', side: 'server', reqId: '', route: '', ...over };
}

describe('buildPerfSection', () => {
  it('is null on a day with no perf numbers', () => {
    expect(buildPerfSection({ digests: [], server: [] })).toBeNull();
  });

  it('gives launch and navigation medians and p95, freezes, the host\'s slowest routes, native deaths and heap growth', () => {
    const H = 3_600_000;
    const digests = [
      d(0, 'u1', { launch: { hydrated: 30_000 }, nav: { n: 3, ms: [1000, 2000, 57_000], worst: [{ to: '/settings', ms: 57_000 }] }, heap: { used: 40 }, freeze: { n: 1, max: 6200 }, rage: 2 }),
      d(2 * H, 'u1', { heap: { used: 46 } }),
      d(0, 'u2', { session: 's2', launch: { hydrated: 4000 }, device: { model: 'Pixel 8' } }),
    ];
    const srv = [
      server({ data: { routes: [{ route: '/settings (rsc)', n: 10, p95: 3200, max: 9000 }, { route: '/api/youtube/stream/:id', n: 5, p95: 90_000, max: 90_000, held: true }, { route: '/rare', n: 1, p95: 9999, max: 9999 }], slow: 4, health: { loopP99: 120 } } }),
      server({ data: { routes: [{ route: '/settings (rsc)', n: 5, p95: 2500, max: 2600 }], slow: 1, health: { loopP99: 40 } } }),
      server({ category: 'native', message: 'gone', data: { event: 'renderer.gone' } }),
      server({ category: 'native', message: 'low', data: { event: 'memory.low' } }),
      server({ category: 'native', message: 'other', data: { event: 'play.stalled' } }),
    ];
    const section = buildPerfSection({ digests, server: srv })!;
    expect(section.lines).toEqual([
      '2 sessions on 2 devices',
      'Launch to ready: median 4.0 s, p95 30.0 s (2)',
      'Navigation: median 2.0 s, p95 57.0 s (3), slowest /settings 57.0 s',
      'Freezes: 1 (longest 6.2 s), rage taps 2',
      'Host: slowest routes /settings (rsc) p95 3200 ms; event loop p99 up to 120 ms; 5 slow requests',
      'Renderer deaths 1, unresponsive 0, low memory 1',
      'Heap per hour: motorola edge 60 +3 MB (1)',
    ]);
    expect(section.numbers.native).toEqual({ rendererGone: 1, rendererUnresponsive: 0, lowMemory: 1 });
  });
});

describe('heapSlopes', () => {
  it('skips sessions shorter than 10 min and averages per model', () => {
    const H = 3_600_000;
    const slopes = heapSlopes([
      d(0, 'u1', { heap: { used: 10 } }),
      d(H, 'u1', { heap: { used: 20 } }),
      d(0, 'u2', { session: 'b', heap: { used: 10 } }),
      d(H, 'u2', { session: 'b', heap: { used: 30 } }),
      d(0, 'u3', { session: 'c', heap: { used: 10 } }),
      d(60_000, 'u3', { session: 'c', heap: { used: 90 } }),
    ]);
    expect(slopes).toEqual([{ model: 'motorola edge 60', mbPerHour: 15, sessions: 2 }]);
  });
});

describe('isPerfNativeEntry', () => {
  it('keeps the renderer and memory events of the phone app only', () => {
    expect(isPerfNativeEntry(server({ category: 'native', data: { event: 'renderer.unresponsive' } }))).toBe(true);
    expect(isPerfNativeEntry(server({ category: 'native', data: { event: 'memory.trim' } }))).toBe(true);
    expect(isPerfNativeEntry(server({ category: 'native', data: { event: 'exit' } }))).toBe(false);
    expect(isPerfNativeEntry(server({ category: 'api', data: { event: 'renderer.gone' } }))).toBe(false);
  });
});
