import { derive, THEME_VARS, type Scheme } from '@/lib/theme/derive';
import { isDefault, resolveInputs, type ThemeDoc } from '@/lib/theme/model';
import { oklchToHex } from '@/lib/theme/oklch';

/** Putting a theme on the page (plan section 3a). Ember is "no overrides":
 *  its style map is empty and applying it removes every variable, so the
 *  page is exactly app/globals.css. Any other theme is inline custom
 *  properties on <html>, which beat `:root`. */

/** The inline style map for <html>: `{}` for Ember. */
export function themeStyle(doc: ThemeDoc): Record<string, string> {
  if (isDefault(doc)) return {};
  return { ...derive(resolveInputs(doc)).vars };
}

export function themeScheme(doc: ThemeDoc): Scheme {
  return derive(resolveInputs(doc)).scheme;
}

/** The theme's background as `#rrggbb`, for `<meta name="theme-color">`. */
export function themeColor(doc: ThemeDoc): string {
  return oklchToHex(resolveInputs(doc).background);
}

export interface ThemeEventDetail {
  scheme: Scheme;
  background: string;
}

/** The single writer of the theme on the live document: sets or clears
 *  every variable, the `dark` class and (for a light theme only, so dark
 *  themes behave exactly like Ember) `color-scheme`, keeps the theme-color
 *  meta in step, and announces the change as an `ember:theme` event. */
export function applyToDocument(doc: ThemeDoc, root: HTMLElement = document.documentElement): void {
  const style = themeStyle(doc);
  for (const name of THEME_VARS) {
    const value = style[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  const scheme = themeScheme(doc);
  root.classList.toggle('dark', scheme === 'dark');
  if (scheme === 'light') root.style.setProperty('color-scheme', 'light');
  else root.style.removeProperty('color-scheme');

  const background = themeColor(doc);
  const ownerDoc = root.ownerDocument;
  const metas = ownerDoc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) {
    const meta = ownerDoc.createElement('meta');
    meta.name = 'theme-color';
    meta.content = background;
    ownerDoc.head.appendChild(meta);
  } else {
    metas.forEach((meta) => {
      meta.content = background;
    });
  }

  const view = ownerDoc.defaultView;
  view?.dispatchEvent(new view.CustomEvent<ThemeEventDetail>('ember:theme', { detail: { scheme, background } }));
}
