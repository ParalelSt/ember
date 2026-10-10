import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The desktop launch gate's update events reaching the server: picked up
// from the shell once per page load, sent to /api/native-log as surface
// 'desktop', kept for the next load when the server refuses them.

const shell = vi.hoisted(() => ({ events: [] as unknown[], fails: false, calls: 0 }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    expect(cmd).toBe('update_gate_events');
    shell.calls += 1;
    if (shell.fails) throw new Error('Command update_gate_events not found');
    const out = shell.events;
    shell.events = [];
    return out;
  }),
}));

const { forwardDesktopGateEvents, toNativeLogBody, _resetDesktopGateEvents } = await import('./desktopGateEvents');
const { NativeLogBodySchema } = await import('@/lib/logger/nativeLog');

const posted: Array<Record<string, unknown>> = [];
let status = 200;
const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetDesktopGateEvents();
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  shell.events = [
    { ts: 1_700_000_000_000, event: 'update.gate.check', data: { ms: 140, result: 'update', install: 'nsis' } },
    { ts: 1_700_000_001_000, event: 'update.gate.failed', data: { stage: 'download', error: 'timed out' } },
  ];
  shell.fails = false;
  shell.calls = 0;
  posted.length = 0;
  status = 200;
  window.localStorage.clear();
  globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)));
    return new Response(null, { status });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('desktop launch gate telemetry', () => {
  it('sends the gate events as one native-log batch the server accepts', async () => {
    expect(await forwardDesktopGateEvents()).toBe(2);
    expect(posted).toHaveLength(1);
    const body = posted[0];
    expect(NativeLogBodySchema.safeParse(body).success).toBe(true);
    const events = body.events as Array<Record<string, unknown>>;
    expect(events.map((e) => [e.event, e.level, e.surface])).toEqual([
      ['update.gate.check', 'info', 'desktop'],
      ['update.gate.failed', 'warn', 'desktop'],
    ]);
    expect(events[0].data).toEqual({ ms: 140, result: 'update', install: 'nsis' });
  });

  it('asks the shell once per page load', async () => {
    await forwardDesktopGateEvents();
    await forwardDesktopGateEvents();
    expect(shell.calls).toBe(1);
  });

  it('keeps a refused batch (signed out) for the next load', async () => {
    status = 401;
    expect(await forwardDesktopGateEvents()).toBe(0);
    _resetDesktopGateEvents();
    status = 200;
    shell.events = [{ ts: 1_700_000_002_000, event: 'update.gate.done', data: { from: '0.4.22', to: '0.4.23' } }];
    expect(await forwardDesktopGateEvents()).toBe(3);
    expect((posted[1].events as unknown[]).length).toBe(3);
    expect(window.localStorage.getItem('ember.desktopGateEvents')).toBeNull();
  });

  it('does nothing outside the desktop app, or on a shell without the command', async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(await forwardDesktopGateEvents()).toBe(0);
    expect(shell.calls).toBe(0);
    _resetDesktopGateEvents();
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    shell.fails = true;
    expect(await forwardDesktopGateEvents()).toBe(0);
    expect(posted).toHaveLength(0);
  });

  it('drops malformed events and oversized data', () => {
    const body = toNativeLogBody([
      { ts: 1, event: 'Bad Name' },
      { ts: -1, event: 'update.gate.check' },
      'junk',
      { ts: 5, event: 'update.gate.shown', data: { blob: 'x'.repeat(5000) } },
    ], 'desktop-abc')!;
    const events = body.events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0].data).toBeUndefined();
    expect(NativeLogBodySchema.safeParse(body).success).toBe(true);
    expect(toNativeLogBody([], 'desktop-abc')).toBeNull();
  });
});
