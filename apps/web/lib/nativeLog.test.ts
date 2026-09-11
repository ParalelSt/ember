import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger } from '@/lib/logger/client';
import { recordNativeLog } from './nativeLog';
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

  // subscribeNativeLog() latches a module-level `subscribed` flag, so the two
  // cases below each reset modules and re-import fresh: sharing the module
  // between them would make the second case's result depend on whether it
  // runs before or after the first.
  it('reports not-listening with no native plugin present', async () => {
    vi.resetModules();
    const { subscribeNativeLog } = await import('./nativeLog');
    const before = nativeEntries().length;
    expect(subscribeNativeLog()).toBe(false);
    expect(nativeEntries().length).toBe(before);
  });

  it('subscribes to the plugin so a fired nativeLog event becomes a log entry', async () => {
    vi.resetModules();
    // resetModules() also gives nativeLog.ts its own fresh copy of the logger
    // singleton, so this test reads back through that same fresh import
    // rather than the top-level `logger` (which would be watching a
    // different ring than the one recordNativeLog actually wrote to).
    const { subscribeNativeLog } = await import('./nativeLog');
    const { logger: freshLogger } = await import('@/lib/logger/client');
    const fire = installPlugin();
    expect(subscribeNativeLog()).toBe(true);

    fire({ level: 'error', category: 'service', message: 'download drain crashed: boom' });
    const entry = freshLogger.snapshot().current.filter((e) => e.category.startsWith('native:')).at(-1)!;
    expect(entry.category).toBe('native:service');
    expect(entry.message).toBe('download drain crashed: boom');
  });
});
