import { afterEach, describe, expect, it, vi } from 'vitest';
import { derive } from '@/lib/theme/derive';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { notifyShell, shellTheme } from './native';

type Win = Record<string, unknown>;
const win = window as unknown as Win;

afterEach(() => {
  delete win.Capacitor;
  delete win.__TAURI__;
  delete win.__TAURI_INTERNALS__;
});

/** A Capacitor shell as the APK injects it, with or without the plugin. */
function capacitor(plugin?: { apply: (...a: unknown[]) => unknown }) {
  win.Capacitor = { isNativePlatform: () => true, Plugins: plugin ? { EmberTheme: plugin } : {} };
}

const MIDNIGHT = shellTheme({ v: 1, preset: 'midnight' });

describe('shellTheme', () => {
  it('gives the background as hex, the scheme and every derived variable', () => {
    expect(MIDNIGHT.background).toBe('#080f1c');
    expect(MIDNIGHT.scheme).toBe('dark');
    expect(MIDNIGHT.vars).toEqual(derive(PRESET_BY_ID.midnight.inputs).vars);
  });

  it('carries the full set for Ember too, because the offline page has no Ember defaults', () => {
    const ember = shellTheme({ v: 1, preset: 'ember' });
    expect(ember.background).toBe('#0c0d0f');
    expect(Object.keys(ember.vars).length).toBeGreaterThanOrEqual(30);
    expect(ember.vars['--background']).toBe('oklch(0.16 0.005 260)');
  });

  it('follows a custom theme over its preset', () => {
    const custom = { ...PRESET_BY_ID.ember.inputs, background: [0, 0, 0] as [number, number, number] };
    expect(shellTheme({ v: 1, preset: 'ember', custom }).background).toBe('#000000');
  });
});

describe('notifyShell', () => {
  it('calls EmberTheme.apply on Android with the vars as JSON', () => {
    const apply = vi.fn(() => Promise.resolve());
    capacitor({ apply });
    notifyShell(MIDNIGHT);
    expect(apply).toHaveBeenCalledTimes(1);
    const [arg] = apply.mock.calls[0] as unknown as [{ background: string; scheme: string; vars: string }];
    expect(arg.background).toBe('#080f1c');
    expect(arg.scheme).toBe('dark');
    expect(JSON.parse(arg.vars)).toEqual(MIDNIGHT.vars);
  });

  it('invokes theme_apply on desktop with the background and scheme only', () => {
    const invoke = vi.fn(() => Promise.resolve());
    win.__TAURI_INTERNALS__ = { invoke };
    notifyShell(MIDNIGHT);
    expect(invoke).toHaveBeenCalledWith('theme_apply', { background: '#080f1c', scheme: 'dark' });
  });

  it('keeps `this` on the Tauri bridge', () => {
    const internals = {
      seen: null as unknown,
      invoke(this: { seen: unknown }) {
        this.seen = this;
        return Promise.resolve();
      },
    };
    win.__TAURI_INTERNALS__ = internals;
    notifyShell(MIDNIGHT);
    expect(internals.seen).toBe(internals);
  });

  it('does nothing in a plain browser', () => {
    const apply = vi.fn();
    // A Capacitor object that is not a native platform is the web build.
    win.Capacitor = { isNativePlatform: () => false, Plugins: { EmberTheme: { apply } } };
    expect(() => notifyShell(MIDNIGHT)).not.toThrow();
    expect(apply).not.toHaveBeenCalled();
  });

  it('is a no-op on an APK from before themes (no EmberTheme plugin)', () => {
    capacitor();
    expect(() => notifyShell(MIDNIGHT)).not.toThrow();
  });

  it('is a no-op on a desktop build whose bridge has no invoke', () => {
    win.__TAURI__ = {};
    expect(() => notifyShell(MIDNIGHT)).not.toThrow();
  });

  it('swallows a rejected call so an old build is never an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      capacitor({ apply: () => Promise.reject(new Error('EmberTheme.apply() is not implemented on android')) });
      notifyShell(MIDNIGHT);
      delete win.Capacitor;
      win.__TAURI_INTERNALS__ = { invoke: () => Promise.reject('Command theme_apply not allowed by ACL') };
      notifyShell(MIDNIGHT);
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('never throws when the plugin itself throws', () => {
    capacitor({
      apply: () => {
        throw new Error('bridge gone');
      },
    });
    expect(() => notifyShell(MIDNIGHT)).not.toThrow();
  });
});
