import { afterEach, describe, expect, it, vi } from 'vitest';
import { shellAppVersion } from './shellVersion';

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'tauri' | 'capacitor' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));
const getVersion = vi.hoisted(() => vi.fn<() => Promise<string>>());
vi.mock('@tauri-apps/api/app', () => ({ getVersion }));

type CapWindow = { Capacitor?: { Plugins?: Record<string, unknown> } };
const win = window as unknown as CapWindow;

afterEach(() => {
  shell.kind = 'web';
  getVersion.mockReset();
  delete win.Capacitor;
});

describe('shellAppVersion', () => {
  it('is null in a browser, without asking any shell', async () => {
    expect(await shellAppVersion()).toBeNull();
    expect(getVersion).not.toHaveBeenCalled();
  });

  it('is the desktop app version from tauri.conf.json', async () => {
    shell.kind = 'tauri';
    getVersion.mockResolvedValue('0.4.14');
    expect(await shellAppVersion()).toBe('0.4.14');
  });

  it('is null when the desktop app refuses (an old build or a missing permission)', async () => {
    shell.kind = 'tauri';
    getVersion.mockRejectedValue(new Error('not allowed'));
    expect(await shellAppVersion()).toBeNull();
  });

  it('is the phone app version from the EmberApp plugin', async () => {
    shell.kind = 'capacitor';
    win.Capacitor = { Plugins: { EmberApp: { info: () => Promise.resolve({ version: '0.4.14', build: 414 }) } } };
    expect(await shellAppVersion()).toBe('0.4.14');
  });

  it('is null on a phone app from before the plugin', async () => {
    shell.kind = 'capacitor';
    win.Capacitor = { Plugins: {} };
    expect(await shellAppVersion()).toBeNull();
  });

  it('is null when the plugin fails or answers nothing usable', async () => {
    shell.kind = 'capacitor';
    win.Capacitor = { Plugins: { EmberApp: { info: () => Promise.reject(new Error('UNIMPLEMENTED')) } } };
    expect(await shellAppVersion()).toBeNull();
    win.Capacitor = { Plugins: { EmberApp: { info: () => Promise.resolve({ version: '  ' }) } } };
    expect(await shellAppVersion()).toBeNull();
    win.Capacitor = { Plugins: { EmberApp: { info: () => { throw new Error('sync'); } } } };
    expect(await shellAppVersion()).toBeNull();
  });
});
