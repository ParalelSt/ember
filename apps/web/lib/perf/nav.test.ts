import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePerformance } from '@/test-utils/fakePerformance';
import { NavTracker, targetLabel, type NavHost, type RscTiming } from './nav';
import { PagePerf } from './core';
import type { NavRecord, RageRecord } from './types';

/** Navigation, tap and rage tap records (docs/android-performance.md,
 *  slice 2), driven through a fake host so the clock, the RSC timings and
 *  the frames are all in the test's hands. */

function makeHost(over: Partial<NavHost> = {}) {
  let clock = 0;
  let lt = 0;
  const navs: NavRecord[] = [];
  const rages: RageRecord[] = [];
  const rsc: RscTiming[] = [];
  let path = '/';
  const laters: { fn: () => void; ms: number }[] = [];
  const host: NavHost = {
    now: () => clock,
    ltTotal: () => lt,
    ltSince: () => 180,
    findRsc: (p, after) => [...rsc].reverse().find((r) => r.path === p && r.start >= after),
    playing: () => true,
    afterPaint: (fn) => {
      clock += 16;
      fn();
    },
    later: (fn, ms) => laters.push({ fn, ms }),
    addNav: (r) => navs.push(r),
    addRage: (r) => rages.push(r),
    doc: () => document,
    currentPath: () => path,
    ...over,
  };
  return {
    host,
    navs,
    rages,
    rsc,
    laters,
    runLaters: () => laters.splice(0).forEach((l) => l.fn()),
    set: (o: { clock?: number; lt?: number; path?: string }) => {
      if (o.clock !== undefined) clock = o.clock;
      if (o.lt !== undefined) lt = o.lt;
      if (o.path !== undefined) path = o.path;
    },
  };
}

function link(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  document.body.appendChild(a);
  return a;
}

/** What NavTracker reads off a click, without happy-dom following the link. */
function click(target: Element, at: number, over: Partial<MouseEvent> = {}): MouseEvent {
  return { target, timeStamp: at, button: 0, clientX: 5, clientY: 5, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over } as unknown as MouseEvent;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('NavTracker: navigation records', () => {
  it('splits a tapped navigation into the phases of section 3 when the RSC answer was slow', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    const a = link('/settings', { 'data-nav': 'Settings' });
    h.set({ clock: 1000, lt: 50 });
    nav.onClick(click(a, 1000));
    // The RSC request: 40 ms to start, 10 ms waiting for a connection,
    // 6.5 s until the host answered, 200 ms to download.
    h.rsc.push({ path: '/settings', start: 1040, requestStart: 1050, responseStart: 7550, responseEnd: 7750, kb: 12, st: { auth: 5800 }, proto: 'h2' });
    h.set({ clock: 8100, lt: 350 });
    nav.onRoute('/settings', '/', 'push');
    expect(h.navs).toHaveLength(1);
    expect(h.navs[0]).toEqual({
      at: 1000,
      from: '/',
      to: '/settings',
      via: 'tap',
      total: 7116,
      tapToRequest: 40,
      queue: 10,
      server: 6500,
      download: 200,
      kb: 12,
      commit: 350,
      paint: 16,
      st: { auth: 5800 },
      proto: 'h2',
      lt: 300,
      playing: true,
    });
  });

  it('waits once for a late RSC entry, then records without it', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    h.set({ clock: 100 });
    nav.onClick(click(link('/library'), 100));
    h.set({ clock: 900 });
    nav.onRoute('/library', '/', 'push');
    expect(h.navs).toHaveLength(0);
    expect(h.laters.some((l) => l.ms === 600)).toBe(true);
    h.runLaters();
    expect(h.navs).toHaveLength(1);
    expect(h.navs[0]).toMatchObject({ to: '/library', via: 'tap', total: 816 });
    expect(h.navs[0].server).toBeUndefined();
  });

  it('ids in the path never reach the record', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    nav.onClick(click(link('/playlist/abc123def456ghi'), 10));
    nav.onRoute('/playlist/abc123def456ghi', '/', 'push');
    h.runLaters();
    expect(h.navs[0].to).toBe('/playlist/:id');
  });

  it('records back/forward and code navigations without a tap', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    h.set({ clock: 5000 });
    h.rsc.push({ path: '/radio', start: 4000, requestStart: 4010, responseStart: 4500, responseEnd: 4600, kb: 3 });
    nav.onRoute('/radio', '/', 'pop');
    expect(h.navs[0]).toMatchObject({ via: 'pop', to: '/radio', total: 1016, server: 490, commit: 400 });
    expect(h.navs[0].tapToRequest).toBeUndefined();
  });

  it('a link marked data-perf-nonav (the Search link opening the sheet) is no navigation', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    nav.onClick(click(link('/search', { 'data-perf-nonav': '' }), 10));
    expect(nav.pendingAge()).toBeUndefined();
  });

  it("a Next <Link> tap still counts though Next cancels the browser's own navigation", () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    h.set({ clock: 1000 });
    const ev = click(link('/library'), 1000);
    nav.onClick(ev);
    (ev as { defaultPrevented: boolean }).defaultPrevented = true;
    h.runLaters();
    h.set({ clock: 1400 });
    nav.onRoute('/library', '/', 'push');
    h.runLaters();
    expect(nav.pendingAge()).toBeUndefined();
    expect(h.navs.some((n) => n.via === 'tap' && n.to === '/library')).toBe(true);
  });

  it('a second tap on another link marks the first one abandoned', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    h.set({ clock: 1000 });
    nav.onClick(click(link('/settings'), 1000));
    h.set({ clock: 4000 });
    nav.onClick(click(link('/library'), 4000));
    expect(h.navs).toEqual([expect.objectContaining({ to: '/settings', abandoned: true, at: 1000 })]);
  });

  it('tags a tap in a nav (side nav, drawer, bottom bar) with its area, abandoned or not', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    const inArea = (area: string, href: string) => {
      const box = document.createElement('div');
      box.setAttribute('data-nav-area', area);
      document.body.appendChild(box);
      const a = link(href, { 'data-nav': href.slice(1) });
      box.appendChild(a);
      return a;
    };
    h.set({ clock: 1000 });
    nav.onClick(click(inArea('drawer', '/settings'), 1000));
    h.set({ clock: 4000 });
    nav.onClick(click(inArea('sidebar', '/library'), 4000));
    h.set({ clock: 5000 });
    nav.onRoute('/library', '/', 'push');
    h.runLaters();
    expect(h.navs[0]).toMatchObject({ to: '/settings', abandoned: true, area: 'drawer' });
    expect(h.navs[1]).toMatchObject({ to: '/library', via: 'tap', area: 'sidebar' });
    // A link outside any nav, and an unknown area value, carry none.
    nav.onClick(click(link('/radio'), 6000));
    nav.onRoute('/radio', '/library', 'push');
    nav.onClick(click(inArea('footer', '/search'), 7000));
    nav.onRoute('/search', '/radio', 'push');
    h.runLaters();
    expect(h.navs[2].area).toBeUndefined();
    expect(h.navs[3].area).toBeUndefined();
  });

  it('ignores links to other sites, new tabs, downloads and modified clicks', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    nav.onClick(click(link('https://elsewhere.example/x'), 1));
    nav.onClick(click(link('/a', { target: '_blank' }), 1));
    nav.onClick(click(link('/b', { download: '' }), 1));
    nav.onClick(click(link('/c'), 1, { metaKey: true }));
    nav.onClick(click(link('/'), 1));
    expect(nav.pendingAge()).toBeUndefined();
  });
});

describe('NavTracker: rage taps', () => {
  it('3 taps on one target within 5 s make one record with what was under the finger', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Open menu');
    document.body.appendChild(btn);
    const overlay = document.createElement('div');
    overlay.setAttribute('data-slot', 'sheet-overlay');
    document.body.appendChild(overlay);
    h.set({ clock: 900 });
    nav.onClick(click(link('/settings', { 'data-nav': 'Settings' }), 900));
    for (const t of [1000, 2500, 4000]) {
      h.set({ clock: t });
      nav.onClick(click(btn, t));
    }
    expect(h.rages).toHaveLength(1);
    expect(h.rages[0]).toMatchObject({ at: 4000, target: 'button', taps: 3, overlay: true, inert: false, lt: 180, pendingMs: 3100 });
    // The count starts again after a record.
    h.set({ clock: 4500 });
    nav.onClick(click(btn, 4500));
    expect(h.rages).toHaveLength(1);
  });

  it('taps spread over more than 5 s, or on different targets, are not rage', () => {
    const h = makeHost();
    const nav = new NavTracker(h.host);
    const a = document.createElement('button');
    a.setAttribute('aria-label', 'A');
    const b = document.createElement('button');
    b.setAttribute('aria-label', 'B');
    const tap = (el: Element, t: number) => {
      h.set({ clock: t });
      nav.onClick(click(el, t));
    };
    tap(a, 0);
    tap(a, 3000);
    tap(a, 9000);
    tap(b, 9100);
    tap(a, 9200);
    expect(h.rages).toHaveLength(0);
  });
});

describe('targetLabel', () => {
  it('never uses aria-label or text, which carry song titles, theme and file names', () => {
    const row = document.createElement('div');
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', 'Open Secret Song Title');
    const inner = document.createElement('span');
    inner.textContent = 'Secret Song Title';
    row.appendChild(inner);
    expect(targetLabel(inner)).toBe('role button');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Share my-theme.json');
    expect(targetLabel(btn)).toBe('button');
    const slotted = document.createElement('button');
    slotted.setAttribute('data-slot', 'dropdown-menu-trigger');
    slotted.setAttribute('aria-label', 'Theme: Midnight Gojira');
    expect(targetLabel(slotted)).toBe('dropdown-menu-trigger');
  });

  it('names a target by data-nav, data-slot or a link\'s shaped path', () => {
    const a = link('/settings', { 'data-nav': 'Settings' });
    a.textContent = 'secret text';
    expect(targetLabel(a)).toBe('Settings');
    const span = document.createElement('span');
    const plain = link('/playlist/abc123def456ghi');
    plain.appendChild(span);
    expect(targetLabel(span)).toBe('link /playlist/:id');
    expect(targetLabel(null)).toBe('unknown');
  });
});

describe('PagePerf: navigation through the core', () => {
  let perf: PagePerf;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    perf.stop('test');
    vi.useRealTimers();
  });

  it('matches the RSC resource entry and Server-Timing to the route change', () => {
    const fake = makeFakePerformance();
    perf = new PagePerf();
    perf.start({ PO: fake.PO, perf: fake.perf });
    perf.setPlaying(() => true);
    const events: string[] = [];
    perf.onEvent((e) => e.kind === 'nav' && events.push(e.rec.to));
    fake.emit('resource', [
      {
        name: 'http://localhost:3000/settings?_rsc=x1',
        startTime: 1000,
        requestStart: 1010,
        responseStart: 4000,
        responseEnd: 4100,
        transferSize: 2048,
        serverTiming: [{ name: 'auth', duration: 2500.4 }],
        nextHopProtocol: 'http/1.1',
      },
    ]);
    fake.setNow(4300);
    perf.onRoute('/settings', '/', 'push');
    vi.advanceTimersByTime(1100);
    const [rec] = perf.navs.toArray();
    expect(rec).toMatchObject({ to: '/settings', via: 'push', server: 2990, st: { auth: 2500 }, proto: 'http/1.1', kb: 2, playing: true });
    expect(events).toEqual(['/settings']);
  });
});
