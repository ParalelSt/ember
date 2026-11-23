import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePerformance, type FakePerformance } from '@/test-utils/fakePerformance';

/** Delivery, page side (slice 5): the digest upload's gates and budget,
 *  sendBeacon on hide, the host's kill switch end to end, and the
 *  automatic perf reports. Each test loads a fresh copy of the modules, so
 *  the page's one perf recorder starts clean. */

const auto = vi.hoisted(() => ({ signedIn: true, reports: [] as [string, string][] }));
vi.mock('@/lib/autoReport', () => ({
  isSignedIn: () => auto.signedIn,
  maybeAutoPerfReport: (kind: string, message: string) => auto.reports.push([kind, message]),
}));

let fake: FakePerformance;
let fetchMock: ReturnType<typeof vi.fn>;
let answer: unknown;

async function load() {
  vi.resetModules();
  const client = await import('./client');
  const { pagePerf } = await import('./index');
  const { useSettingsStore } = await import('@/stores/useSettingsStore');
  const sw = await import('./switch');
  return { ...client, pagePerf, useSettingsStore, sw };
}

beforeEach(() => {
  vi.useFakeTimers();
  fake = makeFakePerformance();
  vi.stubGlobal('PerformanceObserver', fake.PO);
  // The page clock moves only with tick().
  vi.stubGlobal('performance', fake.perf);
  answer = { ok: true, stored: true, sample: 1 };
  fetchMock = vi.fn(async () => Response.json(answer));
  vi.stubGlobal('fetch', fetchMock);
  // happy-dom's sendBeacon really sends: never let a test reach the network.
  vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
  window.sessionStorage.clear();
  window.localStorage.clear();
  auto.signedIn = true;
  auto.reports = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Moves the page clock and the timers together, in heartbeat sized steps
 *  (a single long jump would read as the device asleep). */
async function tick(ms: number) {
  let left = ms;
  do {
    const step = Math.min(left, 1000);
    fake.advance(step);
    await vi.advanceTimersByTimeAsync(step);
    left -= step;
  } while (left > 0);
}

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

describe('bootPerf and the digest upload', () => {
  it('posts a digest with the session, app and device, and nothing that is not a number or a short name', async () => {
    const m = await load();
    m.bootPerf();
    expect(m.pagePerf.on).toBe(true);
    expect(fake.live().length).toBeGreaterThan(0);
    vi.advanceTimersByTime(3000);
    await m.flushDigest(false);
    expect(posts()).toHaveLength(1);
    const [url, init] = posts()[0];
    expect(url).toBe('/api/perf-log');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ v: 1, shell: 'web' });
    expect(typeof body.session).toBe('string');
    m._resetPerfClient();
    m.pagePerf.stop('test');
  });

  it('sends every 5 min while open, through sendBeacon when hidden, at most 14 an hour', async () => {
    const m = await load();
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    m.bootPerf();
    for (let i = 0; i < 3; i++) await tick(m.UPLOAD_EVERY_MS);
    expect(posts()).toHaveLength(3);
    await tick(10_000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    expect(beacon).toHaveBeenCalledTimes(1);
    // Hidden: no timer sends anything.
    await tick(m.UPLOAD_EVERY_MS * 2);
    expect(posts()).toHaveLength(3);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // The hourly budget: 4 used, 10 left.
    for (let i = 0; i < 20; i++) {
      await tick(5000);
      await m.flushDigest(false);
    }
    expect(posts().length + beacon.mock.calls.length).toBe(m.MAX_UPLOADS_PER_HOUR);
    m._resetPerfClient();
    m.pagePerf.stop('test');
  });

  it('sends nothing with automatic reports switched off, or signed out, and keeps recording for a bug report', async () => {
    const m = await load();
    m.bootPerf();
    m.useSettingsStore.setState({ autoReportEnabled: false });
    vi.advanceTimersByTime(3000);
    await m.flushDigest(false);
    m.useSettingsStore.setState({ autoReportEnabled: true });
    auto.signedIn = false;
    await m.flushDigest(false);
    expect(posts()).toHaveLength(0);
    expect(m.pagePerf.on).toBe(true);
    m._resetPerfClient();
    m.pagePerf.stop('test');
  });
});

describe('the kill switch, end to end on the page', () => {
  it('the host answering { off: true } to an upload stops every observer, timer and upload', async () => {
    const m = await load();
    m.bootPerf();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    answer = { off: true };
    vi.advanceTimersByTime(3000);
    await m.flushDigest(false);
    expect(m.pagePerf.on).toBe(false);
    expect(m.pagePerf.offReason).toBe('host');
    expect(fake.live()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(m.sw.sessionOff()).toBe('host');
    await m.flushDigest(false);
    expect(posts()).toHaveLength(1);
    m._resetPerfClient();
  });

  const gets = () => fetchMock.mock.calls.filter(([, init]) => !(init as RequestInit | undefined)?.method);

  it('asks the host on every page load, even where this page may not upload, and switches off', async () => {
    window.sessionStorage.setItem('ember.perf.cfg', '1');
    auto.signedIn = false;
    const m = await load();
    m.useSettingsStore.setState({ autoReportEnabled: false });
    answer = { off: true };
    m.bootPerf();
    await tick(5000);
    expect(gets()).toHaveLength(1);
    expect(m.pagePerf.on).toBe(false);
    expect(fake.live()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    m.useSettingsStore.setState({ autoReportEnabled: true });
    m._resetPerfClient();
  });

  it('asks again every 30 min, so a long-lived app stops when the host switches off later', async () => {
    const m = await load();
    // A page that never uploads: only the config check can reach it.
    m.useSettingsStore.setState({ autoReportEnabled: false });
    answer = { on: true, sample: 1 };
    m.bootPerf();
    await tick(5000);
    expect(gets()).toHaveLength(1);
    expect(m.pagePerf.on).toBe(true);
    answer = { off: true };
    await tick(m.CONFIG_EVERY_MS);
    expect(gets()).toHaveLength(2);
    expect(m.pagePerf.on).toBe(false);
    expect(fake.live()).toHaveLength(0);
    m.useSettingsStore.setState({ autoReportEnabled: true });
    m._resetPerfClient();
  });

  it('asks at once when an app comes back after more than 30 min in the background', async () => {
    const m = await load();
    m.bootPerf();
    await tick(5000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(m.CONFIG_EVERY_MS * 3);
    expect(gets()).toHaveLength(1);
    answer = { off: true };
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    expect(gets()).toHaveLength(2);
    expect(m.pagePerf.on).toBe(false);
    m._resetPerfClient();
  });

  it('rolls the sample share only on the session\'s first answer', async () => {
    const m = await load();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    answer = { on: true, sample: 0.5 };
    window.sessionStorage.setItem('ember.perf.cfg', '1');
    m.bootPerf();
    await tick(5000);
    expect(m.pagePerf.on).toBe(true);
    random.mockRestore();
    m._resetPerfClient();
    m.pagePerf.stop('test');
  });

  it('a reload in the same session stays off and never starts an observer', async () => {
    window.sessionStorage.setItem('ember.perf.off', 'host');
    const m = await load();
    m.bootPerf();
    expect(m.pagePerf.on).toBe(false);
    expect(fake.observers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(m.pagePerf.block()).toMatchObject({ on: false, off: 'host' });
    m._resetPerfClient();
  });
});

describe('automatic perf reports', () => {
  it('files one for a freeze over 5 s, a navigation over 8 s and a launch over 15 s, not for shorter ones', async () => {
    const m = await load();
    m.bootPerf();
    const emit = (e: unknown) => (m.pagePerf as unknown as { emit(e: unknown): void }).emit(e);
    emit({ kind: 'freeze', rec: { at: 0, gapMs: 4000 } });
    emit({ kind: 'freeze', rec: { at: 0, gapMs: 6200 } });
    emit({ kind: 'nav', rec: { at: 0, from: '/', to: '/settings', via: 'tap', lt: 0, total: 9100 } });
    emit({ kind: 'nav', rec: { at: 0, from: '/', to: '/x', via: 'tap', lt: 0, total: 9100, abandoned: true } });
    emit({ kind: 'launch', ms: 30_300 });
    emit({ kind: 'launch', ms: 3000 });
    expect(auto.reports).toEqual([
      ['freeze', 'page froze for 6.2 s'],
      ['nav', 'slow navigation to /settings: 9.1 s'],
      ['launch', 'slow launch: 30.3 s until the page answered'],
    ]);
    m._resetPerfClient();
    m.pagePerf.stop('test');
  });
});
