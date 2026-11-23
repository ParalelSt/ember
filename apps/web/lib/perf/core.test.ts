import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePerformance, type FakePerformance } from '@/test-utils/fakePerformance';
import { PagePerf, PERF_LIMITS, deviceFacts, shortSource } from './core';
import { Ring } from './ring';
import { Histogram, quantileOf } from './histogram';
import { routeShape, isRscUrl } from './route';

/** The page perf core (docs/android-performance.md, slice 1): rings that
 *  stay bounded, observers fed by a fake PerformanceObserver, the freeze
 *  heartbeat, the memory sampler and the kill switch. */

let fake: FakePerformance;
let perf: PagePerf;

function start(opts: Parameters<typeof makeFakePerformance>[0] = {}) {
  fake = makeFakePerformance(opts);
  perf = new PagePerf();
  perf.start({ PO: fake.PO, perf: fake.perf });
  return perf;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  perf?.stop('test');
  vi.useRealTimers();
});

describe('Ring', () => {
  it('keeps the newest items up to its capacity, oldest first', () => {
    const r = new Ring<number>(3);
    for (let i = 1; i <= 5; i++) r.push(i);
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.size).toBe(3);
    expect(r.last()).toBe(5);
    r.clear();
    expect(r.toArray()).toEqual([]);
    expect(r.last()).toBeUndefined();
  });
});

describe('Histogram', () => {
  it('reads quantiles from fixed buckets, never above the max', () => {
    const h = new Histogram();
    for (const ms of [12, 30, 45, 90, 3000]) h.add(ms);
    expect(h.count).toBe(5);
    expect(h.max).toBe(3000);
    // 45 falls in the (40, 60] bucket.
    expect(h.quantile(0.5)).toBe(60);
    expect(h.quantile(1)).toBe(3000);
    h.add(-1);
    h.add(Number.NaN);
    expect(h.count).toBe(5);
  });

  it('holds the same number of buckets however much is added', () => {
    const h = new Histogram();
    for (let i = 0; i < 10_000; i++) h.add(i * 13);
    expect(h.counts).toHaveLength(21);
  });

  it('quantileOf works on a plain list', () => {
    expect(quantileOf([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantileOf([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(quantileOf([], 0.5)).toBe(0);
  });
});

describe('routeShape', () => {
  it('keeps short lowercase words and turns everything else into :id', () => {
    expect(routeShape('/settings/help')).toBe('/settings/help');
    expect(routeShape('/playlist/k3j4h5g6f7d8s9a?x=1')).toBe('/playlist/:id');
    expect(routeShape('/api/youtube/stream/dQw4w9WgXcQ')).toBe('/api/youtube/stream/:id');
    expect(routeShape('https://host.example/artist/UCabc123?_rsc=1')).toBe('/artist/:id');
    expect(routeShape('/_next/static/chunks/app.js')).toBe('/_next/static');
    expect(routeShape('/')).toBe('/');
  });

  it('takes artist names and every other dynamic segment out by the app\'s own route tree', () => {
    expect(routeShape('/mix/artist-gojira')).toBe('/mix/:id');
    expect(routeShape('/api/mixes/artist-gojira')).toBe('/api/mixes/:id');
    expect(routeShape('/api/admin/artist-genres/gojira')).toBe('/api/admin/artist-genres/:id');
    expect(routeShape('/chart/rock')).toBe('/chart/:id');
    // A dynamic value that happens to spell a folder name is still an id.
    expect(routeShape('/playlist/settings')).toBe('/playlist/:id');
    // Paths the app does not know keep nothing.
    expect(routeShape('/somewhere/private-name')).toBe('/:id/:id');
    expect(routeShape('/pb/api/collections/users/records')).toBe('/pb/:id');
    expect(routeShape('/settings/help')).toBe('/settings/help');
  });

  it('walks any tree it is given', () => {
    const tree = { s: { a: { d: { s: { b: {} } } }, files: { c: 1 as const } } };
    expect(routeShape('/a/x1/b', tree)).toBe('/a/:id/b');
    expect(routeShape('/files/one/two/three', tree)).toBe('/files/:id');
  });

  it('spots RSC requests', () => {
    expect(isRscUrl('https://h/settings?_rsc=abc')).toBe(true);
    expect(isRscUrl('https://h/settings')).toBe(false);
  });
});

describe('PagePerf: long tasks', () => {
  it('uses long-animation-frame where supported, with the top script sources', () => {
    start();
    expect(fake.live().map((o) => o.type)).toContain('long-animation-frame');
    expect(fake.live().map((o) => o.type)).not.toContain('longtask');
    fake.emit('long-animation-frame', [
      { startTime: 100, duration: 180, blockingDuration: 120, scripts: [{ duration: 110, sourceURL: 'https://h/_next/static/chunks/page-abc.js?v=1' }] },
      { startTime: 400, duration: 90, blockingDuration: 30, scripts: [{ duration: 40, sourceURL: '', invokerType: 'event-listener' }] },
      { startTime: 900, duration: 60, blockingDuration: 0, scripts: [] },
    ]);
    const lt = perf.longTasks();
    expect(lt.n).toBe(2);
    expect(lt.ms).toBe(150);
    expect(lt.max).toBe(120);
    expect(lt.top[0]).toEqual(['page-abc.js', 120]);
    expect(lt.top[1]).toEqual(['event-listener', 30]);
  });

  it('falls back to longtask when long-animation-frame is not there', () => {
    start({ types: ['longtask', 'event', 'paint', 'resource'] });
    expect(fake.live().map((o) => o.type)).toContain('longtask');
    fake.emit('longtask', [{ startTime: 10, duration: 70 }, { startTime: 200, duration: 55 }]);
    expect(perf.longTasks()).toMatchObject({ n: 2, ms: 125, max: 70 });
  });

  it('caps the number of script sources it keeps apart', () => {
    start();
    const entries = Array.from({ length: 50 }, (_, i) => ({
      startTime: i * 100,
      duration: 100,
      blockingDuration: 50,
      scripts: [{ duration: 90, sourceURL: `https://h/chunk-${i}.js` }],
    }));
    fake.emit('long-animation-frame', entries);
    const lt = perf.longTasks();
    expect(lt.n).toBe(50);
    expect(lt.top.length).toBeLessThanOrEqual(5);
    // 20 named sources and one "other" bucket for the rest.
    expect(lt.top.some(([s]) => s === 'other')).toBe(true);
  });

  it('shortSource keeps only the file name', () => {
    expect(shortSource('https://h/a/b/c.js?x=1#y')).toBe('c.js');
    expect(shortSource(undefined)).toBe('');
  });
});

describe('PagePerf: slow interactions', () => {
  it('records slow taps once per interaction, the slowest event of it, labelled not by text', () => {
    start();
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Open menu');
    btn.textContent = 'private words';
    fake.emit('event', [
      { name: 'pointerdown', startTime: 1000, duration: 120, processingStart: 1050, processingEnd: 1080, interactionId: 7, target: btn },
      { name: 'click', startTime: 1010, duration: 240, processingStart: 1060, processingEnd: 1200, interactionId: 7, target: btn },
      { name: 'pointerover', startTime: 1500, duration: 300, processingStart: 1500, processingEnd: 1500, interactionId: 0 },
      { name: 'click', startTime: 2000, duration: 50, processingStart: 2000, processingEnd: 2010, interactionId: 8 },
    ]);
    const slow = perf.slow.toArray();
    expect(slow).toHaveLength(1);
    expect(slow[0]).toMatchObject({ type: 'click', ms: 240, inputDelay: 50, handler: 140, paint: 50, target: 'Open menu' });
    expect(JSON.stringify(slow)).not.toContain('private');
  });

  it('keeps at most 20 slow interactions', () => {
    start();
    fake.emit(
      'event',
      Array.from({ length: 30 }, (_, i) => ({ name: 'click', startTime: i * 1000, duration: 200, processingStart: i * 1000, processingEnd: i * 1000 + 10, interactionId: i + 1 })),
    );
    expect(perf.slow.size).toBe(PERF_LIMITS.slow);
    expect(perf.slow.toArray()[0].at).toBe(10_000);
  });
});

describe('PagePerf: freeze heartbeat', () => {
  it('records a gap when the 2 s heartbeat comes late, and tells listeners', () => {
    start();
    const events: string[] = [];
    perf.onEvent((e) => events.push(e.kind));
    fake.advance(2000);
    vi.advanceTimersByTime(2000);
    expect(perf.freezes.size).toBe(0);
    // The main thread was stuck: the next beat arrives 9 s later.
    fake.advance(9000);
    vi.advanceTimersByTime(2000);
    expect(perf.freezes.toArray()).toEqual([{ at: 2000, gapMs: 9000 }]);
    expect(events).toContain('freeze');
  });

  it('runs no timers while the page is hidden', () => {
    start();
    expect(vi.getTimerCount()).toBe(2);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(2);
  });
});

describe('PagePerf: memory sampler', () => {
  it('samples heap, DOM size and the app sizes every 60 s, in a ring of 30', () => {
    start({ memory: true });
    perf.setSize('queue', () => 1234);
    perf.setSize('broken', () => {
      throw new Error('no');
    });
    vi.advanceTimersByTime(60_000);
    const [s] = perf.memory.toArray();
    expect(s.used).toBe(40);
    expect(s.total).toBe(60);
    expect(s.limit).toBe(512);
    expect(s.dom).toBeGreaterThan(0);
    expect(s.sizes).toEqual({ queue: 1234 });
    vi.advanceTimersByTime(60_000 * 40);
    expect(perf.memory.size).toBe(PERF_LIMITS.memory);
  });

  it('works without performance.memory', () => {
    start();
    const s = perf.sampleMemory();
    expect(s?.used).toBeUndefined();
    expect(typeof s?.dom).toBe('number');
  });
});

describe('PagePerf: launch record', () => {
  it('fills the launch record from navigation timing, first paint, hydration and the scripts loaded', () => {
    fake = makeFakePerformance();
    fake.setEntries('navigation', [{ responseStart: 820.4, domContentLoadedEventEnd: 2100, nextHopProtocol: 'h2' }]);
    fake.setEntries('resource', [
      { name: 'https://h/_next/static/a.js', initiatorType: 'script', transferSize: 50 * 1024, decodedBodySize: 1 },
      { name: 'https://h/_next/static/b.js', initiatorType: 'script', transferSize: 0, decodedBodySize: 900 },
      { name: 'https://h/cover.png', initiatorType: 'img', transferSize: 9000, decodedBodySize: 9000 },
    ]);
    perf = new PagePerf();
    perf.start({ PO: fake.PO, perf: fake.perf });
    const launches: number[] = [];
    perf.onEvent((e) => e.kind === 'launch' && launches.push(e.ms));
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 2500 }]);
    fake.setNow(30_300);
    perf.markHydrated();
    vi.runOnlyPendingTimers();
    expect(perf.launch).toMatchObject({ ttfb: 820, domReady: 2100, proto: 'h2', fcp: 2500, hydrated: 30_300, scripts: 2, scriptKb: 50, cached: 1 });
    expect(perf.launchReady()).toBe(true);
    expect(launches).toEqual([30_300]);
  });
});

describe('PagePerf: API calls', () => {
  it('groups /api calls by route with the ids taken out, at most 40 routes', () => {
    start();
    fake.emit('resource', [
      { name: 'https://h/api/likes', startTime: 0, responseStart: 300, duration: 400, transferSize: 4096 },
      { name: 'https://h/api/likes', startTime: 0, responseStart: 1200, duration: 1300, transferSize: 4096 },
      { name: 'https://h/api/playlists/abc123def456ghi/tracks', startTime: 0, responseStart: 90, duration: 100, transferSize: 0 },
      { name: 'https://h/cover.png', startTime: 0, responseStart: 10, duration: 10 },
    ]);
    const stats = perf.apiStats();
    expect(stats.map((s) => s.route)).toEqual(['/api/likes', '/api/playlists/:id/tracks']);
    expect(stats[0]).toMatchObject({ n: 2, max: 1200, kb: 8 });
    fake.emit(
      'resource',
      Array.from({ length: 60 }, (_, i) => ({ name: `https://h/api/r${'x'.repeat(i % 26)}${String.fromCharCode(97 + (i % 26))}/z${i}a`, startTime: 0, responseStart: 5, duration: 5 })),
    );
    expect(perf.apiStats().length).toBeLessThanOrEqual(PERF_LIMITS.apiRoutes + 1);
  });
});

describe('PagePerf: kill switch', () => {
  it('stop() disconnects every observer, clears every timer and listener, and keeps what was recorded', () => {
    start();
    fake.emit('longtask', []);
    fake.emit('long-animation-frame', [{ startTime: 0, duration: 100, blockingDuration: 50, scripts: [] }]);
    expect(fake.live().length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(2);
    const seen: string[] = [];
    perf.onEvent((e) => seen.push(e.kind));

    perf.stop('host');

    expect(perf.on).toBe(false);
    expect(fake.live()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    // Clicks and visibility no longer reach it.
    const before = perf.rage.size;
    for (let i = 0; i < 5; i++) document.body.click();
    expect(perf.rage.size).toBe(before);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    expect(seen).toEqual([]);
    expect(perf.longTasks().n).toBe(1);
    expect(perf.block()).toMatchObject({ on: false, off: 'host' });
  });

  it('cannot be started again after stop', () => {
    perf = new PagePerf();
    perf.stop('sample');
    fake = makeFakePerformance();
    perf.start({ PO: fake.PO, perf: fake.perf });
    expect(perf.on).toBe(false);
    expect(fake.observers).toHaveLength(0);
  });
});

describe('deviceFacts', () => {
  it('reads memory, cores and the phone model, and skips the frozen "K" model', () => {
    const nav = { deviceMemory: 4, hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (Linux; Android 15; motorola edge 60 Build/X) Chrome/157', connection: { effectiveType: '4g' } };
    expect(deviceFacts(nav as unknown as Navigator)).toEqual({ mem: 4, cores: 8, model: 'motorola edge 60 Build/X', net: '4g' });
    expect(deviceFacts({ userAgent: 'Mozilla/5.0 (Linux; Android 10; K) Chrome/157' } as unknown as Navigator).model).toBeUndefined();
  });
});
