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
  afterEach(() => document.documentElement.classList.remove('car'));

  it('adds the car class when the user agent has the marker', () => {
    const nav = { userAgent: `x ${CAR_UA_MARKER}` };
    new Function('navigator', 'document', CAR_CLASS_SCRIPT)(nav, document);
    expect(document.documentElement.classList.contains('car')).toBe(true);
  });
  it('leaves a phone untouched', () => {
    new Function('navigator', 'document', CAR_CLASS_SCRIPT)({ userAgent: 'Mozilla Mobile' }, document);
    expect(document.documentElement.classList.contains('car')).toBe(false);
  });
});

describe('markup and css gating', () => {
  it('layout puts the script in <head> before the body', () => {
    const src = readFileSync(join(root, 'app/layout.tsx'), 'utf8');
    expect(src.indexOf('CAR_CLASS_SCRIPT')).toBeGreaterThan(-1);
    expect(src.indexOf('<head>')).toBeLessThan(src.indexOf('<body'));
    expect(src.indexOf('CAR_CLASS_SCRIPT }}')).toBeLessThan(src.indexOf('<body'));
  });
  it('the rotate lock only shows outside .car, with the phone heuristic kept', () => {
    const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 500px\) \{\s*html:not\(\.car\) \.rotate-lock \{/);
    expect(css).not.toMatch(/\n\s*\.rotate-lock \{\s*\n\s*display: flex/);
  });
});
