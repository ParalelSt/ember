import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePerformance } from '@/test-utils/fakePerformance';
import { PagePerf } from './core';
import { buildDigest } from './digest';
import { NavTracker, READY_CAP_MS, type NavHost } from './nav';
import { ApiWatch } from './ready';
import type { NavRecord } from './types';

/** "Content ready" per navigation: the time from the tap until the page's
 *  skeletons are gone and none of its data requests is in flight. */

const ORIGIN = 'https://ember.test';

describe('ApiWatch', () => {
  it('counts only the app data calls in flight, by route shape', () => {
    let t = 100;
    const w = new ApiWatch(() => t);
    const done = w.begin('/api/playlists?x=1', ORIGIN);
    expect(w.begin('/api/youtube/stream/abc', ORIGIN)).toBeNull();
    expect(w.begin('/api/perf-log', ORIGIN)).toBeNull();
    expect(w.begin('/api/remote/beat', ORIGIN)).toBeNull();
    expect(w.begin('https://other.test/api/x', ORIGIN)).toBeNull();
    expect(w.begin('/_next/static/a.js', ORIGIN)).toBeNull();
    expect(w.openSince(0)).toBe(1);
    expect(w.openSince(101)).toBe(0);
    t = 700;
    done!();
    expect(w.openSince(0)).toBe(0);
    expect(w.lastEnded(0)).toBe('/api/playlists');
    expect(w.lastEnded(200)).toBeUndefined();
  });

  it('names the request that ended last', () => {
    let t = 0;
    const w = new ApiWatch(() => t);
    const a = w.begin('/api/playlists', ORIGIN)!;
    const b = w.begin('/api/youtube/recommended', ORIGIN)!;
    t = 100;
    b();
    t = 900;
    a();
    expect(w.lastEnded(0)).toBe('/api/playlists');
  });

  it('wraps fetch, returns the very same promise, and puts the old one back', async () => {
    const orig = vi.fn(() => Promise.resolve(new Response('{}')));
    const win = { fetch: orig, location: { origin: ORIGIN } } as unknown as Window & typeof globalThis;
    const w = new ApiWatch(() => 0);
    const undo = w.install(win);
    const p = win.fetch('/api/playlists');
    expect(w.openSince(0)).toBe(1);
    await p;
    await Promise.resolve();
    expect(w.openSince(0)).toBe(0);
    undo();
    expect(win.fetch).toBe(orig);
  });

  it('counts a failed request as finished', async () => {
    const win = { fetch: () => Promise.reject(new Error('offline')), location: { origin: ORIGIN } } as unknown as Window & typeof globalThis;
    const w = new ApiWatch(() => 0);
    w.install(win);
    await expect(win.fetch('/api/playlists')).rejects.toThrow('offline');
    await Promise.resolve();
    expect(w.openSince(0)).toBe(0);
  });
});

function makeHost() {
  let clock = 0;
  let path = '/';
  let skeletons = 0;
  let open = 0;
  let last: string | undefined;
  const navs: NavRecord[] = [];
  const laters: { fn: () => void; at: number }[] = [];
  const host: NavHost = {
    now: () => clock,
    ltTotal: () => 0,
    ltSince: () => 0,
    // The router data request of a tapped link; none for a back/forward.
    findRsc: (path, after) =>
      after < 0 ? undefined : { path, start: after + 5, requestStart: after + 10, responseStart: after + 20, responseEnd: after + 30, kb: 1 },
    playing: () => false,
    afterPaint: (fn) => {
      clock += 16;
      fn();
    },
    later: (fn, ms) => laters.push({ fn, at: clock + ms }),
    addNav: (r) => navs.push(r),
    addRage: () => {},
    doc: () => document,
    currentPath: () => path,
    skeletons: () => skeletons,
    apiOpen: () => open,
    apiLast: () => last,
  };
  return {
    host,
    navs,
    /** Moves the clock, running the timers that fall due on the way. */
    run(ms: number) {
      const end = clock + ms;
      for (;;) {
        laters.sort((a, b) => a.at - b.at);
        const next = laters[0];
        if (!next || next.at > end) break;
        laters.shift();
        clock = next.at;
        next.fn();
      }
      clock = end;
    },
    set: (o: { clock?: number; path?: string; skeletons?: number; open?: number; last?: string }) => {
      if (o.clock !== undefined) clock = o.clock;
      if (o.path !== undefined) path = o.path;
      if (o.skeletons !== undefined) skeletons = o.skeletons;
      if (o.open !== undefined) open = o.open;
      if (o.last !== undefined) last = o.last;
    },
  };
}

function tapTo(h: ReturnType<typeof makeHost>, nav: NavTracker, to: string, at: number) {
  const a = document.createElement('a');
  a.setAttribute('href', to);
  a.setAttribute('data-nav-area', 'sidebar');
  document.body.appendChild(a);
  h.set({ clock: at });
  nav.onClick({ target: a, timeStamp: at, button: 0, clientX: 1, clientY: 1, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false } as unknown as MouseEvent);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('NavTracker: content ready', () => {
  it('is ready when the skeleton is gone and the data request has ended, and names the slow request', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    tapTo(h, nav, '/library', 1000);
    h.set({ clock: 1300, path: '/library', skeletons: 3, open: 1, last: '/api/playlists' });
    nav.onRoute('/library', '/', 'push');
    const rec = h.navs[0];
    expect(rec.total).toBe(316);
    expect(rec.ready).toBeUndefined();
    // Still loading 1.2 s later.
    h.run(1200);
    expect(rec.ready).toBeUndefined();
    // The request ends, then the page draws; the skeleton goes a bit later.
    h.set({ open: 0 });
    h.run(100);
    expect(rec.ready).toBeUndefined();
    h.set({ skeletons: 0 });
    h.run(200);
    // The skeleton went at 2616; seen clear at once.
    expect(rec.ready).toBeGreaterThanOrEqual(1616);
    expect(rec.ready).toBeLessThan(1700);
    expect(rec.wait).toBe(rec.ready! - 316);
    expect(rec.waitApi).toBe('/api/playlists');
  });

  it('has no wait and no slow api when the page was complete at its first paint', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    tapTo(h, nav, '/settings', 500);
    h.set({ clock: 600, path: '/settings', last: '/api/playlists' });
    nav.onRoute('/settings', '/', 'push');
    h.run(200);
    const rec = h.navs[0];
    expect(rec.ready).toBe(rec.total);
    expect(rec.wait).toBe(0);
    expect(rec.waitApi).toBeUndefined();
  });

  it('is capped at 15 s from the tap', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    tapTo(h, nav, '/library', 0);
    h.set({ clock: 400, path: '/library', skeletons: 2, open: 2, last: '/api/playlists' });
    nav.onRoute('/library', '/', 'push');
    h.run(20_000);
    const rec = h.navs[0];
    expect(rec.ready).toBe(READY_CAP_MS);
    expect(rec.wait).toBe(READY_CAP_MS - rec.total!);
  });

  it('records nothing when the user left the page first', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    tapTo(h, nav, '/library', 0);
    h.set({ clock: 100, path: '/library', skeletons: 1 });
    nav.onRoute('/library', '/', 'push');
    h.run(300);
    h.set({ path: '/search', skeletons: 0 });
    h.run(1000);
    expect(h.navs[0].ready).toBeUndefined();
  });

  it('stops the older watch when a newer navigation starts, even to the same path', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    h.set({ clock: 100, path: '/library', skeletons: 1 });
    nav.onRoute('/library', '/', 'pop');
    h.run(700);
    expect(h.navs).toHaveLength(1);
    nav.onRoute('/library', '/library', 'pop');
    h.set({ skeletons: 0 });
    h.run(700);
    expect(h.navs).toHaveLength(2);
    expect(h.navs[0].ready).toBeUndefined();
    expect(h.navs[1].ready).toBeDefined();
  });
});

describe('PagePerf: content ready end to end', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for a skeleton to go after a fetch resolves, and puts it in the digest', async () => {
    const fake = makeFakePerformance();
    let resolve!: (r: Response) => void;
    const win = {
      fetch: () => new Promise<Response>((r) => (resolve = r)),
      location: { pathname: '/', origin: ORIGIN },
      addEventListener: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16),
    } as unknown as Window & typeof globalThis;
    document.body.innerHTML = '<aside><div data-slot="skeleton"></div></aside><main><div id="sk" data-slot="skeleton"></div></main>';
    const step = (ms: number) => {
      fake.advance(ms);
      vi.advanceTimersByTime(ms);
    };
    const perf = new PagePerf();
    perf.start({ win, doc: document, PO: fake.PO, perf: fake.perf });
    fake.setNow(1000);
    (win as unknown as { location: unknown }).location = { pathname: '/library', origin: ORIGIN };
    perf.onRoute('/library', '/', 'push');
    const pending = win.fetch('/api/playlists');
    step(100);
    step(900);
    expect(perf.navs.last()?.ready).toBeUndefined();
    resolve(new Response('[]'));
    await pending;
    // The response is in but the skeleton (in <main>) is still up.
    step(200);
    expect(perf.navs.last()?.ready).toBeUndefined();
    document.getElementById('sk')!.remove();
    step(200);
    const rec = perf.navs.last()!;
    expect(rec.ready).toBeGreaterThanOrEqual(1200);
    expect(rec.ready).toBeLessThanOrEqual(1500);
    expect(rec.wait).toBe(rec.ready! - (rec.paint ?? 0));
    expect(rec.waitApi).toBe('/api/playlists');
    const d = buildDigest(perf, { session: 's', seq: 1, t0: 0, app: 'a', shell: 'web', os: 'macos', withLaunch: false })!;
    const ev = d.ev!.find((e) => e.k === 'nav') as { ready?: number; wait?: number; api?: string };
    expect(ev.ready).toBe(rec.ready);
    expect(ev.api).toBe('/api/playlists');
    perf.stop('test');
  });
});
