import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePerformance, type FakePerformance } from '@/test-utils/fakePerformance';

/** Delivery, page side (slice 5): a session's batches (numbered, every
 *  5 min and on leaving, by sendBeacon then), who sends, the hourly budget,
 *  the host's kill switch end to end, and no report on the spot. Each test loads a fresh copy of the modules, so
 *  the page's one perf recorder starts clean. */

const auto = vi.hoisted(() => ({ signedIn: true }));
vi.mock('@/lib/autoReport', () => ({
  isSignedIn: () => auto.signedIn,
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

  it('sends every 5 min while open, through sendBeacon when hidden, at most 20 an hour', async () => {
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
    // The hourly budget: 4 used, 16 left.
    for (let i = 0; i < 30; i++) {
      await tick(5000);
      await m.flushDigest(false);
    }
    expect(posts().length + beacon.mock.calls.length).toBe(m.MAX_UPLOADS_PER_HOUR);
    m._resetPerfClient();
    m.pagePerf.stop('test');
  });

  it('sends whatever the automatic reports setting says; only a signed-out page sends nothing', async () => {
    const m = await load();
    m.bootPerf();
    m.useSettingsStore.setState({ autoReportEnabled: false });
    await tick(3000);
    await m.flushDigest(false);
    expect(posts()).toHaveLength(1);
    m.useSettingsStore.setState({ autoReportEnabled: true });
    auto.signedIn = false;
    await tick(3000);
    await m.flushDigest(false);
    expect(posts()).toHaveLength(1);
    expect(m.pagePerf.on).toBe(true);
    m._resetPerfClient();
    m.pagePerf.stop('test');
  });

  it('numbers a session\'s batches, and the one sent on leaving carries what was not sent yet', async () => {
    const m = await load();
    m.bootPerf();
    const emit = (e: unknown) => (m.pagePerf as unknown as { addNav(r: unknown): void }).addNav(e);
    emit({ at: 1000, from: '/', to: '/settings', via: 'tap', lt: 0, total: 9100, server: 8000 });
    await tick(m.UPLOAD_EVERY_MS);
    const first = JSON.parse((posts()[0][1] as RequestInit).body as string);
    expect(first).toMatchObject({ seq: 1, ev: [{ k: 'nav', to: '/settings', ms: 9100, server: 8000 }] });
    expect(first.t0).toBeGreaterThan(0);
    // Something happens, then the app is closed before the next 5 min.
    emit({ at: 400_000, from: '/settings', to: '/library', via: 'tap', lt: 0, total: 700 });
    await tick(10_000);
    window.dispatchEvent(new Event('pagehide'));
    await tick(0);
    const beacon = vi.mocked(navigator.sendBeacon);
    expect(beacon).toHaveBeenCalledTimes(1);
    const blob = (beacon.mock.calls[0] as unknown[])[1] as Blob;
    const last = JSON.parse(await blob.text());
    expect(last).toMatchObject({ seq: 2, session: first.session, ev: [{ k: 'nav', to: '/library', ms: 700 }] });
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
    answer = { off: true };
    m.bootPerf();
    await tick(5000);
    expect(gets()).toHaveLength(1);
    expect(m.pagePerf.on).toBe(false);
    expect(fake.live()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    m._resetPerfClient();
  });

  it('asks again every 30 min, so a long-lived app stops when the host switches off later', async () => {
    const m = await load();
    // A page that never uploads (signed out): only the config check reaches it.
    auto.signedIn = false;
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

describe('no report on the spot', () => {
  it('a slow launch, navigation or freeze only goes into the session\'s batches', async () => {
    const m = await load();
    m.bootPerf();
    const emit = (e: unknown) => (m.pagePerf as unknown as { emit(e: unknown): void }).emit(e);
    emit({ kind: 'freeze', rec: { at: 0, gapMs: 60_000 } });
    emit({ kind: 'nav', rec: { at: 0, from: '/', to: '/settings', via: 'tap', lt: 0, total: 90_000 } });
    emit({ kind: 'launch', ms: 90_000 });
    await tick(0);
    expect(fetchMock).not.toHaveBeenCalled();
    m._resetPerfClient();
    m.pagePerf.stop('test');
  });
});
