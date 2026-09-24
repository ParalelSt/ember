import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyToDocument, htmlProps, themeColor, themeScheme, themeStyle, type ThemeEventDetail } from '@/lib/theme/css';
import { derive, THEME_VARS } from '@/lib/theme/derive';
import { DEFAULT_THEME, type ThemeDoc } from '@/lib/theme/model';
import { EMBER_INPUTS, PRESET_BY_ID } from '@/lib/theme/presets';

const MIDNIGHT: ThemeDoc = { v: 1, preset: 'midnight' };
const LIGHT: ThemeDoc = {
  v: 1,
  preset: 'ember',
  custom: { ...EMBER_INPUTS, background: [0.97, 0, 0], text: [0.2, 0, 0], mutedText: [0.45, 0, 0], border: [0, 0, 0] },
};

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.className = '';
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
});

describe('themeStyle', () => {
  it('is empty for Ember, so the page is exactly globals.css', () => {
    expect(themeStyle(DEFAULT_THEME)).toEqual({});
    expect(themeStyle({ v: 1, preset: 'forest', custom: { ...EMBER_INPUTS } })).toEqual({});
  });

  it('is every derived variable for any other theme', () => {
    const style = themeStyle(MIDNIGHT);
    expect(Object.keys(style).sort()).toEqual([...THEME_VARS].sort());
    expect(style['--background']).toBe('oklch(0.17 0.03 262)');
    expect(style).toEqual(derive(PRESET_BY_ID.midnight.inputs).vars);
  });

  it('gives the scheme and the theme-color hex', () => {
    expect(themeScheme(MIDNIGHT)).toBe('dark');
    expect(themeScheme(LIGHT)).toBe('light');
    expect(themeColor(DEFAULT_THEME)).toBe('#0c0d0f');
    expect(themeColor({ v: 1, preset: 'mono' })).toBe('#000000');
  });
});

describe('htmlProps (the root layout)', () => {
  it('renders exactly the pre-themes <html> for Ember: font class plus dark, no style', () => {
    expect(htmlProps('__inter', DEFAULT_THEME)).toEqual({ className: '__inter dark', style: {} });
  });

  it('adds the variables for any other theme and keeps dark for a dark one', () => {
    const props = htmlProps('__inter', MIDNIGHT);
    expect(props.className).toBe('__inter dark');
    expect(props.style['--background']).toBe('oklch(0.17 0.03 262)');
    expect(Object.keys(props.style)).toHaveLength(THEME_VARS.length);
  });

  it('drops dark and sets color-scheme for a light theme', () => {
    const props = htmlProps('__inter', LIGHT);
    expect(props.className).toBe('__inter');
    expect(props.style.colorScheme).toBe('light');
  });
});

describe('applyToDocument', () => {
  const root = () => document.documentElement;

  it('sets every variable for a theme, and removes them all again for Ember', () => {
    applyToDocument(MIDNIGHT);
    expect(root().style.getPropertyValue('--background')).toBe('oklch(0.17 0.03 262)');
    expect(root().style.getPropertyValue('--ember')).toBe('oklch(0.75 0.14 225)');
    for (const name of THEME_VARS) expect(root().style.getPropertyValue(name), name).not.toBe('');

    applyToDocument(DEFAULT_THEME);
    for (const name of THEME_VARS) expect(root().style.getPropertyValue(name), name).toBe('');
    expect(root().getAttribute('style') ?? '').toBe('');
  });

  it('leaves other inline styles alone', () => {
    root().style.setProperty('--ember-inset-top', '24px');
    applyToDocument(MIDNIGHT);
    applyToDocument(DEFAULT_THEME);
    expect(root().style.getPropertyValue('--ember-inset-top')).toBe('24px');
  });

  it('keeps the dark class for dark themes and sets color-scheme only for a light one', () => {
    root().classList.add('font-x');
    applyToDocument(MIDNIGHT);
    expect(root().classList.contains('dark')).toBe(true);
    expect(root().style.getPropertyValue('color-scheme')).toBe('');
    applyToDocument(LIGHT);
    expect(root().classList.contains('dark')).toBe(false);
    expect(root().style.getPropertyValue('color-scheme')).toBe('light');
    applyToDocument(DEFAULT_THEME);
    expect(root().classList.contains('dark')).toBe(true);
    expect(root().classList.contains('font-x')).toBe(true);
    expect(root().style.getPropertyValue('color-scheme')).toBe('');
  });

  it('creates the theme-color meta when missing, and updates every one there is', () => {
    applyToDocument(MIDNIGHT);
    const metas = () => [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    expect(metas().map((m) => m.content)).toEqual(['#080f1c']);
    const second = document.createElement('meta');
    second.name = 'theme-color';
    document.head.appendChild(second);
    applyToDocument({ v: 1, preset: 'mono' });
    expect(metas().map((m) => m.content)).toEqual(['#000000', '#000000']);
  });

  it('announces the change as an ember:theme event', () => {
    const seen = vi.fn();
    const listener = (e: Event) => seen((e as CustomEvent<ThemeEventDetail>).detail);
    window.addEventListener('ember:theme', listener);
    applyToDocument(MIDNIGHT);
    window.removeEventListener('ember:theme', listener);
    expect(seen).toHaveBeenCalledWith({ scheme: 'dark', background: '#080f1c' });
  });
});
