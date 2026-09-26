import { afterEach, describe, expect, it } from 'vitest';
import { isIosApp, nativePlatform } from './nativePlatform';

type W = { Capacitor?: unknown };

function setCapacitor(value: unknown) {
  (window as unknown as W).Capacitor = value;
}

describe('nativePlatform', () => {
  afterEach(() => {
    delete (window as unknown as W).Capacitor;
  });

  it('is null in a plain browser', () => {
    expect(nativePlatform()).toBeNull();
    expect(isIosApp()).toBe(false);
  });

  it('reports ios inside the iPhone app', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    expect(nativePlatform()).toBe('ios');
    expect(isIosApp()).toBe(true);
  });

  it('reports android inside the Android app', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'android' });
    expect(nativePlatform()).toBe('android');
    expect(isIosApp()).toBe(false);
  });

  it('ignores a Capacitor global that is not a native platform', () => {
    setCapacitor({ isNativePlatform: () => false, getPlatform: () => 'web' });
    expect(nativePlatform()).toBeNull();
  });

  it('is null when the bridge has no getPlatform', () => {
    setCapacitor({ isNativePlatform: () => true });
    expect(nativePlatform()).toBeNull();
  });
});
