import { describe, expect, it } from 'vitest';
import type { ServerLogEntry } from '@/lib/logger/types';
import { buildHostRollup, hostForPage, nativeByOs } from './hostRollup';

/** The host side of the perf channel: the server's timing lines summed over
 *  the window, and native perf events per platform. */

function line(over: Partial<ServerLogEntry>): ServerLogEntry {
  return { ts: 1, kind: 'log', level: 'info', category: 'perf', message: 'server timing', sessionId: 'server', side: 'server', reqId: '', route: '', ...over } as ServerLogEntry;
}
const timing = (routes: unknown[], more: Record<string, unknown> = {}) => line({ data: { routes, ...more } });
const native = (event: string, surface?: string) => line({ category: 'native', message: 'n', userId: 'u1', ...(surface ? { surface } : {}), data: { event } } as never);

describe('buildHostRollup', () => {
  it('sums routes over the 5 min lines: requests, weighted median, worst p95, max', () => {
    const h = buildHostRollup([
      timing([{ route: '/settings (rsc)', n: 9, p50: 100, p95: 400, max: 500 }], { slow: 1, health: { loopP99: 30 } }),
      timing([{ route: '/settings (rsc)', n: 1, p50: 9000, p95: 9000, max: 9000 }], { slow: 2, health: { loopP99: 90 } }),
    ]);
    expect(h).toMatchObject({ lines: 2, requests: 10, slowRequests: 3, loopP99Max: 90 });
    // Nine requests at 100 outweigh one at 9000.
    expect(h.routes).toEqual([{ route: '/settings (rsc)', n: 10, p50: 100, p95: 9000, max: 9000 }]);
  });

  it('ranks the slowest by median, needs 3 requests, leaves held streams out', () => {
    const h = buildHostRollup([
      timing([
        { route: '/a', n: 5, p50: 300, p95: 900, max: 1000 },
        { route: '/b', n: 5, p50: 800, p95: 900, max: 1000 },
        { route: '/rare', n: 2, p50: 9999, p95: 9999, max: 9999 },
        { route: '/api/youtube/stream/:id', n: 50, p50: 90_000, p95: 90_000, max: 90_000, held: true },
      ]),
    ]);
    expect(h.slowest.map((r) => r.route)).toEqual(['/b', '/a']);
    expect(h.routes.map((r) => r.route)).toEqual(['/rare', '/b', '/a']);
    expect(hostForPage(h, '/rare')).toBeUndefined();
  });

  it('survives malformed lines and counts the desktop app\'s native events on the host', () => {
    const h = buildHostRollup([
      line({ data: undefined }),
      timing([null, { route: 7 }, { route: '/x', n: -1 }, { route: '/y', n: 'many' }]),
      native('renderer.unresponsive', 'desktop'),
      native('renderer.gone', 'phone'),
    ]);
    expect(h).toMatchObject({ lines: 2, requests: 0, routes: [] });
    expect(h.desktopNative).toEqual({ rendererGone: 0, rendererUnresponsive: 1, lowMemory: 0, trimMemory: 0 });
  });
});

describe('nativeByOs', () => {
  it('counts renderer deaths, unresponsive, low memory and trim for Android (phone, car, no surface), not the desktop', () => {
    const m = nativeByOs([
      native('renderer.gone', 'phone'),
      native('renderer.crash', 'aaos'),
      native('renderer.unresponsive'),
      native('memory.low', 'android-auto'),
      native('memory.trim', 'phone'),
      native('memory.trim', 'phone'),
      native('state', 'phone'),
      native('renderer.gone', 'desktop'),
    ]);
    expect([...m.keys()]).toEqual(['android']);
    expect(m.get('android')).toEqual({ rendererGone: 2, rendererUnresponsive: 1, lowMemory: 1, trimMemory: 2 });
  });
});
