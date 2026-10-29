import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CAR_CLASS_SCRIPT, CAR_UA_MARKER, isCarUserAgent } from './carUa';

const root = join(__dirname, '..');

describe('isCarUserAgent', () => {
  it('detects the marker the Android app appends', () => {
    expect(isCarUserAgent(`Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile ${CAR_UA_MARKER}`)).toBe(true);
  });
  it('is false for phones and empty values', () => {
    expect(isCarUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile')).toBe(false);
    expect(isCarUserAgent('')).toBe(false);
    expect(isCarUserAgent(null)).toBe(false);
  });
});

describe('head script', () => {
  afterEach(() => document.documentElement.classList.remove('car', 'landscape-screen'));

  const portrait = { orientation: { type: 'portrait-primary', angle: 0 } };
  const run = (userAgent: string, screen: unknown = portrait) =>
    new Function('navigator', 'document', 'screen', CAR_CLASS_SCRIPT)({ userAgent }, document, screen);
  const has = (c: string) => document.documentElement.classList.contains(c);

  it('adds the car class when the user agent has the marker', () => {
    run(`x ${CAR_UA_MARKER}`);
    expect(has('car')).toBe(true);
  });
  it('leaves a phone untouched', () => {
    run('Mozilla Mobile');
    expect(has('car')).toBe(false);
    expect(has('landscape-screen')).toBe(false);
  });
  it('leaves a phone turned on its side to the rotate lock', () => {
    run('Mozilla Mobile', { orientation: { type: 'landscape-primary', angle: 90 } });
    run('Mozilla Mobile', { orientation: { type: 'landscape-secondary', angle: 270 } });
    expect(has('landscape-screen')).toBe(false);
  });
  it('marks a screen that is landscape the right way up (a car head unit, no car marker)', () => {
    run('Mozilla/5.0 (Linux; Android 10; wv) Chrome/120 Safari/537.36', { orientation: { type: 'landscape-primary', angle: 0 } });
    expect(has('landscape-screen')).toBe(true);
    expect(has('car')).toBe(false);
  });
  it('never throws without screen.orientation (older iOS)', () => {
    expect(() => run('iPhone', {})).not.toThrow();
    expect(() => run('iPhone', undefined)).not.toThrow();
    expect(has('landscape-screen')).toBe(false);
  });
});

describe('markup and css gating', () => {
  it('layout puts the script in <head> before the body', () => {
    const src = readFileSync(join(root, 'app/layout.tsx'), 'utf8');
    expect(src.indexOf('CAR_CLASS_SCRIPT')).toBeGreaterThan(-1);
    expect(src.indexOf('<head>')).toBeLessThan(src.indexOf('<body'));
    expect(src.indexOf('CAR_CLASS_SCRIPT }}')).toBeLessThan(src.indexOf('<body'));
  });
  it('the rotate lock only shows outside .car and .landscape-screen, with the phone heuristic kept', () => {
    const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 500px\) \{\s*html:not\(\.car\):not\(\.landscape-screen\) \.rotate-lock \{/);
    expect(css).not.toMatch(/\n\s*\.rotate-lock \{\s*\n\s*display: flex/);
  });
});
