import { afterEach, describe, expect, it, vi } from 'vitest';

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'capacitor' | 'tauri' }));
vi.mock('./detectShell', () => ({ detectShell: () => shell.kind }));

const { isPartyEligible, appVolume } = await import('./partyDevice');

const coarse = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(pointer: coarse)' }) as MediaQueryList);

afterEach(() => {
  vi.unstubAllGlobals();
  shell.kind = 'web';
});

describe('isPartyEligible', () => {
  it('is true on a plain web browser with a fine (mouse) pointer', () => {
    coarse(false);
    expect(isPartyEligible()).toBe(true);
  });

  it('is false on a plain web browser with a coarse (touch) pointer — a phone or tablet', () => {
    coarse(true);
    expect(isPartyEligible()).toBe(false);
  });

  it('is always false on Capacitor (the Android app, iOS to come), touch or not', () => {
    shell.kind = 'capacitor';
    coarse(false);
    expect(isPartyEligible()).toBe(false);
    coarse(true);
    expect(isPartyEligible()).toBe(false);
  });

  it('is always true on the Tauri desktop app, regardless of pointer', () => {
    shell.kind = 'tauri';
    coarse(true);
    expect(isPartyEligible()).toBe(true);
    coarse(false);
    expect(isPartyEligible()).toBe(true);
  });

  it('is false with no window (SSR)', () => {
    const original = globalThis.window;
    // @ts-expect-error simulating SSR
    delete globalThis.window;
    expect(isPartyEligible()).toBe(false);
    globalThis.window = original;
  });
});

describe('appVolume', () => {
  it('is the stored volume where a volume slider exists (desktop)', () => {
    coarse(false);
    expect(appVolume(0.4)).toBe(0.4);
  });

  it('is always 1 on a touch browser and on Capacitor, whatever is stored', () => {
    coarse(true);
    expect(appVolume(0.4)).toBe(1);
    expect(appVolume(0)).toBe(1);
    shell.kind = 'capacitor';
    coarse(false);
    expect(appVolume(0.85)).toBe(1);
  });
});
