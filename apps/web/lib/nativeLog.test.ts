import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { logger } from '@/lib/logger/client';
import { recordNativeLog, subscribeNativeLog } from './nativeLog';
import type { NativeLogEvent } from '@/lib/offlineNative';

/** The plugin as the WebView sees it: addListener keeps the callback so the
 *  test can fire an event the way Capacitor would. */
function installPlugin() {
  const listeners: Record<string, ((e: NativeLogEvent) => void)[]> = {};
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    Plugins: {
      EmberOffline: {
        addListener(event: string, cb: (e: NativeLogEvent) => void) {
          (listeners[event] ??= []).push(cb);
        },
      },
    },
  };
  return (event: NativeLogEvent) => listeners.nativeLog?.forEach((cb) => cb(event));
}

/** Entries this test put in the shared logger ring. */
function nativeEntries() {
  return logger.snapshot().current.filter((e) => e.category.startsWith('native:'));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('native log forwarding', () => {
  it('maps an error event to a logger error under a native: category', () => {
    const before = nativeEntries().length;
    recordNativeLog({
      level: 'error',
      category: 'offline',
      message: 'download failed: auth',
      data: { pinId: 'p1', reason: 'auth' },
      ts: 1700000000000,
    });

    const entry = nativeEntries().at(-1)!;
    expect(nativeEntries().length).toBe(before + 1);
    expect(entry.category).toBe('native:offline');
    expect(entry.kind).toBe('error');
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('download failed: auth');
    expect(entry.data).toMatchObject({ pinId: 'p1', reason: 'auth', level: 'error', nativeTs: 1700000000000 });
  });

  it('maps warn and info events to breadcrumbs that keep their native level', () => {
    recordNativeLog({ level: 'warn', category: 'offline', message: 'pin rejected: id required' });
    recordNativeLog({ level: 'info', category: 'service', message: 'download service started' });

    const [warn, info] = nativeEntries().slice(-2);
    expect(warn.kind).toBe('breadcrumb');
    expect(warn.category).toBe('native:offline');
    expect(warn.data).toMatchObject({ level: 'warn' });
    expect(info.kind).toBe('breadcrumb');
    expect(info.category).toBe('native:service');
    expect(info.data).toMatchObject({ level: 'info' });
  });

  it('falls back to native:unknown rather than dropping an event with no category', () => {
    recordNativeLog({ level: 'error', category: '', message: 'mystery' });
    expect(nativeEntries().at(-1)!.category).toBe('native:unknown');
  });

  // Before the subscribing case: the module-level guard latches once a real
  // plugin is found, and off Android there is nothing to subscribe to.
  it('reports not-listening with no native plugin present', () => {
    const before = nativeEntries().length;
    expect(subscribeNativeLog()).toBe(false);
    expect(nativeEntries().length).toBe(before);
  });

  it('subscribes to the plugin so a fired nativeLog event becomes a log entry', () => {
    const fire = installPlugin();
    expect(subscribeNativeLog()).toBe(true);

    fire({ level: 'error', category: 'service', message: 'download drain crashed: boom' });
    const entry = nativeEntries().at(-1)!;
    expect(entry.category).toBe('native:service');
    expect(entry.message).toBe('download drain crashed: boom');
  });
});
