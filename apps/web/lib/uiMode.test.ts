import { describe, expect, it } from 'vitest';
import { defaultUiMode, parseUiMode, resolveUiMode, uiModeFromCookieHeader, uiModeSetCookie } from './uiMode';

describe('lib/uiMode', () => {
  it('knows only the two modes', () => {
    expect(parseUiMode('new')).toBe('new');
    expect(parseUiMode('legacy')).toBe('legacy');
    expect(parseUiMode('Legacy')).toBeNull();
    expect(parseUiMode(undefined)).toBeNull();
  });

  it('defaults to the new look, or to EMBER_DEFAULT_UI when it names a mode', () => {
    expect(defaultUiMode(undefined)).toBe('new');
    expect(defaultUiMode('')).toBe('new');
    expect(defaultUiMode('legacy')).toBe('legacy');
    expect(defaultUiMode(' legacy ')).toBe('legacy');
    expect(defaultUiMode('classic')).toBe('new');
  });

  it('a cookie wins over the default', () => {
    expect(resolveUiMode('new', 'legacy')).toBe('new');
    expect(resolveUiMode('legacy', undefined)).toBe('legacy');
    expect(resolveUiMode('junk', 'legacy')).toBe('legacy');
    expect(resolveUiMode(undefined, undefined)).toBe('new');
  });

  it('reads the mode out of a cookie header', () => {
    expect(uiModeFromCookieHeader('a=1; ember_ui=legacy; b=2')).toBe('legacy');
    expect(uiModeFromCookieHeader('ember_ui=new')).toBe('new');
    expect(uiModeFromCookieHeader('ember_ui=x')).toBeNull();
    expect(uiModeFromCookieHeader('')).toBeNull();
    expect(uiModeFromCookieHeader(null)).toBeNull();
  });

  it('writes a year-long, site-wide, Lax cookie', () => {
    expect(uiModeSetCookie('legacy', false)).toBe('ember_ui=legacy; Path=/; Max-Age=31536000; SameSite=Lax');
    expect(uiModeSetCookie('new', true)).toMatch(/; Secure$/);
  });
});
