import { afterEach, describe, expect, it } from 'vitest';
import { CAR_UA_MARKER } from './carUa';
import { isHeadUnit, isHeadUnitProbe, type HeadUnitProbe } from './headUnit';

/** A car head unit (owner's pick): Android's own car signals, else a wide
 *  and short screen that is landscape the right way up, in the Android app. */

const UA = 'Mozilla/5.0 (Linux; Android 10; wv) Chrome/120 Safari/537.36';
const upright = { type: 'landscape-primary', angle: 0 };
const probe = (over: Partial<HeadUnitProbe>): HeadUnitProbe => ({ ua: UA, androidApp: true, orientation: upright, width: 1024, height: 600, ...over });

describe('isHeadUnitProbe', () => {
  it.each([
    ['1024x600', 1024, 600],
    ['1280x720', 1280, 720],
    ['1920x720', 1920, 720],
    ['a 1280x720 panel at 1.5x (853x480)', 853, 480],
    ['a 1920x720 panel at 2x (960x360)', 960, 360],
  ])('a head unit panel of %s in the Android app', (_n, width, height) => {
    expect(isHeadUnitProbe(probe({ width, height }))).toBe(true);
  });

  it('whatever Android calls a car (automotive, car mode) by the app marker', () => {
    expect(isHeadUnitProbe(probe({ ua: `${UA} ${CAR_UA_MARKER}`, orientation: null, width: 1080, height: 1920 }))).toBe(true);
  });

  it('not a phone on its side (rotation 90 or 270)', () => {
    expect(isHeadUnitProbe(probe({ orientation: { type: 'landscape-primary', angle: 90 }, width: 844, height: 390 }))).toBe(false);
    expect(isHeadUnitProbe(probe({ orientation: { type: 'landscape-secondary', angle: 270 }, width: 844, height: 390 }))).toBe(false);
  });

  it('not a phone upright, nor a tablet', () => {
    expect(isHeadUnitProbe(probe({ orientation: { type: 'portrait-primary', angle: 0 }, width: 390, height: 844 }))).toBe(false);
    expect(isHeadUnitProbe(probe({ width: 1280, height: 800 }))).toBe(false);
    expect(isHeadUnitProbe(probe({ width: 1024, height: 768 }))).toBe(false);
  });

  it('only in the Android app, and only when the screen says how it is turned', () => {
    expect(isHeadUnitProbe(probe({ androidApp: false }))).toBe(false);
    expect(isHeadUnitProbe(probe({ orientation: null }))).toBe(false);
    expect(isHeadUnitProbe(probe({ width: 0, height: 0 }))).toBe(false);
  });
});

describe('isHeadUnit', () => {
  type W = { Capacitor?: unknown };
  const realScreen = Object.getOwnPropertyDescriptor(window, 'screen');
  afterEach(() => {
    delete (window as unknown as W).Capacitor;
    if (realScreen) Object.defineProperty(window, 'screen', realScreen);
  });

  it('reads the app and the screen', () => {
    (window as unknown as W).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    Object.defineProperty(window, 'screen', { configurable: true, value: { width: 1280, height: 720, orientation: upright } });
    expect(isHeadUnit()).toBe(true);
    Object.defineProperty(window, 'screen', { configurable: true, value: { width: 1280, height: 720, orientation: { type: 'landscape-primary', angle: 90 } } });
    expect(isHeadUnit()).toBe(false);
  });

  it('is false in a browser', () => {
    Object.defineProperty(window, 'screen', { configurable: true, value: { width: 1280, height: 720, orientation: upright } });
    expect(isHeadUnit()).toBe(false);
  });
});
