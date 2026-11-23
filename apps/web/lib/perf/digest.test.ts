import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakePerformance, type FakePerformance } from '@/test-utils/fakePerformance';
import { PagePerf } from './core';
import { buildDigest, DIGEST_MAX_BYTES, fitDigest } from './digest';
import { applyHostAnswer, configChecked, markConfigChecked, onPerfSwitch, sessionOff, switchOff } from './switch';
import type { PerfDigest } from './types';

/** The periodic digest (at most 2 KB, a window that resets) and the page
 *  side of the kill switch. */

let fake: FakePerformance;
let perf: PagePerf;
const meta = { session: 'sess-1', app: '0.7.51', shell: 'capacitor', withLaunch: true };

beforeEach(() => {
  vi.useFakeTimers();
  fake = makeFakePerformance({ memory: true });
  perf = new PagePerf();
  perf.start({ PO: fake.PO, perf: fake.perf });
  window.sessionStorage.clear();
});

afterEach(() => {
  perf.stop('test');
  vi.useRealTimers();
});

describe('buildDigest', () => {
  it('carries the window: foreground time, long tasks, navigations, freezes, heap and API routes', () => {
    fake.emit('long-animation-frame', [{ startTime: 0, duration: 300, blockingDuration: 250, scripts: [{ duration: 200, sourceURL: 'https://h/x.js' }] }]);
    fake.emit('resource', [{ name: 'https://h/api/likes', startTime: 0, responseStart: 900, duration: 1000, transferSize: 2048 }]);
    perf.onRoute('/settings', '/', 'push');
    fake.advance(1000);
    vi.advanceTimersByTime(2000);
    fake.advance(60_000);
    const d = buildDigest(perf, meta)!;
    expect(d).toMatchObject({ v: 1, session: 'sess-1', app: '0.7.51', shell: 'capacitor', lt: { n: 1, ms: 250, max: 250, top: [['x.js', 250]] }, heap: { used: 40, limit: 512 } });
    expect(d.fgMs).toBe(61_000);
    expect(d.api).toEqual([['/api/likes', 1, 900, 900]]);
    expect(typeof d.dom).toBe('number');
    expect(new TextEncoder().encode(JSON.stringify(d)).length).toBeLessThanOrEqual(DIGEST_MAX_BYTES);
  });

  it('resets the window, and has nothing to say right after', () => {
    fake.advance(5000);
    expect(buildDigest(perf, { ...meta, withLaunch: false })).not.toBeNull();
    expect(buildDigest(perf, { ...meta, withLaunch: false })).toBeNull();
  });

  it('puts the launch record in only when asked', () => {
    fake.setEntries('navigation', [{ responseStart: 500, domContentLoadedEventEnd: 900, nextHopProtocol: 'h2' }]);
    perf.stop('x');
    perf = new PagePerf();
    perf.start({ PO: fake.PO, perf: fake.perf });
    fake.advance(2000);
    expect(buildDigest(perf, meta)?.launch).toMatchObject({ ttfb: 500 });
    fake.advance(2000);
    expect(buildDigest(perf, { ...meta, withLaunch: false })?.launch).toBeUndefined();
  });
});

describe('fitDigest', () => {
  it('drops the least useful parts until it fits 2 KB', () => {
    const big: PerfDigest = {
      v: 1,
      session: 's',
      app: '1',
      shell: 'web',
      device: { model: 'm'.repeat(40) },
      fgMs: 1,
      lt: { n: 1, ms: 1, max: 1, top: Array.from({ length: 5 }, () => ['x'.repeat(60), 1] as [string, number]) },
      nav: { n: 20, ms: Array.from({ length: 20 }, () => 1234567), worst: [{ to: '/'.repeat(120), ms: 1 }, { to: '/'.repeat(120), ms: 1 }] },
      api: Array.from({ length: 5 }, () => ['/api/'.repeat(80), 1, 1, 1] as [string, number, number, number]),
    };
    const out = fitDigest(big);
    expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThanOrEqual(DIGEST_MAX_BYTES);
    expect(out.api).toBeUndefined();
    expect(out.nav?.n).toBe(20);
  });
});

describe('the page kill switch', () => {
  it('the host saying off switches the session off and tells listeners', () => {
    const heard: string[] = [];
    const off = onPerfSwitch((on, reason) => heard.push(`${on}:${reason}`));
    expect(sessionOff()).toBeNull();
    applyHostAnswer({ off: true });
    expect(sessionOff()).toBe('host');
    expect(heard).toEqual(['false:host']);
    off();
  });

  it('a sample under 1 is rolled once, on the session\'s first answer only', () => {
    applyHostAnswer({ ok: true, sample: 0.1 }, { random: () => 0.9 });
    expect(sessionOff()).toBeNull();
    applyHostAnswer({ on: true, sample: 0.1 }, { roll: true, random: () => 0.05 });
    expect(sessionOff()).toBeNull();
    applyHostAnswer({ on: true, sample: 0.1 }, { roll: true, random: () => 0.5 });
    expect(sessionOff()).toBe('sample');
  });

  it('ignores answers that are not objects, and remembers the config check', () => {
    applyHostAnswer(null);
    applyHostAnswer('off');
    expect(sessionOff()).toBeNull();
    expect(configChecked()).toBe(false);
    markConfigChecked();
    expect(configChecked()).toBe(true);
    switchOff('sample');
    expect(sessionOff()).toBe('sample');
  });
});
