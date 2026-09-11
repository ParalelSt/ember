import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { makeTrack } from '@/test-utils/fakeBackend';
import { logger } from './client';

beforeEach(() => {
  usePlayerStore.setState({
    queue: [],
    index: -1,
    isPlaying: false,
    loopMode: 'off',
    shuffle: false,
  });
  useOfflineStore.setState({ downloaded: [] });
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClientLogger: context envelope', () => {
  it('snapshot() builds context from the seeded stores plus setContext overrides', () => {
    const track = makeTrack({ id: 'youtube:a1', source: 'youtube', title: 'Song' });
    usePlayerStore.setState({
      queue: [track],
      index: 0,
      isPlaying: true,
      loopMode: 'all',
      shuffle: true,
    });
    useOfflineStore.setState({ downloaded: ['p1', 'p2'] });
    logger.boot();
    logger.setContext({ backendKind: 'tauri-native' });

    const { context } = logger.snapshot();
    expect(context.track).toEqual({ id: 'youtube:a1', source: 'youtube', title: 'Song' });
    expect(context.queue).toEqual({ index: 0, length: 1 });
    expect(context.isPlaying).toBe(true);
    expect(context.loopMode).toBe('all');
    expect(context.shuffle).toBe(true);
    expect(context.offlinePins).toBe(2);
    expect(context.backendKind).toBe('tauri-native');
    expect(context.shell).toBe('web');
    expect(typeof context.appVersion).toBe('string');
    expect(context.route).toBe(window.location.pathname);
  });

  it('reports no current track when the queue is empty', () => {
    logger.boot();
    const { context } = logger.snapshot();
    expect(context.track).toBeNull();
    expect(context.queue).toEqual({ index: -1, length: 0 });
  });
});

describe('ClientLogger: console breadcrumbs', () => {
  it('dedupes an identical console.error within 1s but not when 2s apart', () => {
    vi.useFakeTimers();
    logger.boot();

    console.error('client-test: boom');
    vi.advanceTimersByTime(500);
    console.error('client-test: boom');

    let entries = logger.snapshot().current.filter((e) => e.message === 'client-test: boom');
    expect(entries).toHaveLength(1);

    vi.advanceTimersByTime(1500); // 2000ms since the first call
    console.error('client-test: boom');

    entries = logger.snapshot().current.filter((e) => e.message === 'client-test: boom');
    expect(entries).toHaveLength(2);
  });

  it('does not dedupe across different messages', () => {
    vi.useFakeTimers();
    logger.boot();

    console.error('client-test: alpha');
    console.error('client-test: beta');

    const entries = logger
      .snapshot()
      .current.filter((e) => e.message === 'client-test: alpha' || e.message === 'client-test: beta');
    expect(entries).toHaveLength(2);
  });
});

describe('ClientLogger: click breadcrumbs', () => {
  it('records only the aria-label + route for a click on a labelled button, never its text', () => {
    logger.boot();

    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Play button label');
    btn.textContent = 'Secret track title must not leak';
    document.body.appendChild(btn);

    try {
      btn.click();
      const entries = logger.snapshot().current.filter((e) => e.category === 'ui');
      expect(entries).toHaveLength(1);
      expect(entries[0].data).toEqual({ label: 'Play button label', route: window.location.pathname });
      expect(JSON.stringify(entries[0])).not.toContain('Secret track title');
    } finally {
      document.body.removeChild(btn);
    }
  });

  it('walks up to the closest aria-labelled ancestor (e.g. an icon inside a button)', () => {
    logger.boot();

    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Shuffle');
    const icon = document.createElement('span');
    btn.appendChild(icon);
    document.body.appendChild(btn);

    try {
      icon.click();
      const entries = logger.snapshot().current.filter((e) => e.category === 'ui');
      expect(entries.some((e) => (e.data as { label: string }).label === 'Shuffle')).toBe(true);
    } finally {
      document.body.removeChild(btn);
    }
  });

  it('ignores clicks on elements with no aria-label', () => {
    logger.boot();

    const div = document.createElement('div');
    document.body.appendChild(div);

    try {
      const before = logger.snapshot().current.filter((e) => e.category === 'ui').length;
      div.click();
      const after = logger.snapshot().current.filter((e) => e.category === 'ui').length;
      expect(after).toBe(before);
    } finally {
      document.body.removeChild(div);
    }
  });
});

describe('ClientLogger: ring buffer', () => {
  it('holds at most 400 entries, dropping the oldest first', () => {
    for (let i = 0; i < 450; i++) logger.breadcrumb('test', `entry ${i}`);
    const { current } = logger.snapshot();
    expect(current).toHaveLength(400);
    expect(current[current.length - 1].message).toBe('entry 449');
  });
});

describe('ClientLogger: previous-session archive', () => {
  it('survives a flush (pagehide) / reload cycle via localStorage', async () => {
    window.localStorage.removeItem('ember.logs.last');

    // Simulate the tab that generated the logs: a fresh ClientLogger module
    // instance (a page load gets one singleton), boot, log, then flush like
    // pagehide/visibilitychange does.
    vi.resetModules();
    const first = await import('./client');
    first.logger.boot();
    first.logger.breadcrumb('test', 'hello');
    first.logger.breadcrumb('test', 'world');
    window.dispatchEvent(new Event('pagehide'));

    // Simulate the reload: a brand new module instance hydrating from
    // whatever the previous one flushed.
    vi.resetModules();
    const second = await import('./client');
    second.logger.boot();

    // first.logger.boot() also records the initial route breadcrumb; only
    // the two explicit breadcrumbs are this test's concern.
    const { previous } = second.logger.snapshot();
    expect(previous.map((e) => e.message)).toEqual(expect.arrayContaining(['hello', 'world']));
    expect(previous.filter((e) => e.category === 'test')).toHaveLength(2);
  });
});
