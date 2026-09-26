import { afterEach, describe, expect, it, vi } from 'vitest';

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'capacitor' | 'tauri', plugin: false }));
vi.mock('./detectShell', () => ({ detectShell: () => shell.kind }));
vi.mock('./androidBackend', () => ({ androidPluginPresent: () => shell.plugin }));

const { eqForDevice, eqNeedsConsent, phoneWebAudio } = await import('./eqDevice');

const coarse = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(pointer: coarse)' }) as MediaQueryList);
const BASS = { enabled: true, bands: [7, 4, 0, 0, 0] };

afterEach(() => {
  vi.unstubAllGlobals();
  shell.kind = 'web';
  shell.plugin = false;
});

describe('eqDevice', () => {
  it('only web audio on a touch screen needs the listener to choose it there', () => {
    coarse(true);
    expect(eqNeedsConsent('web')).toBe(true);
    expect(eqNeedsConsent('capacitor')).toBe(true);
    expect(eqNeedsConsent('android')).toBe(false);
    expect(eqNeedsConsent('tauri-native')).toBe(false);
    expect(eqNeedsConsent(null)).toBe(false);
    coarse(false);
    expect(eqNeedsConsent('web')).toBe(false);
  });

  it('phoneWebAudio reads the shell: not the desktop app, not the Android app with its native player', () => {
    coarse(true);
    expect(phoneWebAudio()).toBe(true);
    shell.kind = 'capacitor';
    expect(phoneWebAudio()).toBe(true);
    shell.plugin = true;
    expect(phoneWebAudio()).toBe(false);
    shell.kind = 'tauri';
    expect(phoneWebAudio()).toBe(false);
  });

  it('turns the account setting off where it is needed and not chosen, and leaves it alone otherwise', () => {
    expect(eqForDevice(BASS, true, false)).toEqual({ ...BASS, enabled: false });
    expect(eqForDevice(BASS, true, true)).toBe(BASS);
    expect(eqForDevice(BASS, false, false)).toBe(BASS);
  });
});
