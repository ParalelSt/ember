/** The top nav's links, one place instead of copied into Sidebar and
 *  Drawer. Icons are referenced by name, not by component, so this file
 *  stays free of React and Next like the rest of lib/ (a plain Node test
 *  can import it); NavLinks maps names to icon components. */
export type NavIcon = 'home' | 'search' | 'library' | 'radio' | 'settings' | 'admin';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export const BASE_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/search', label: 'Search', icon: 'search' },
  { href: '/library', label: 'Library', icon: 'library' },
  { href: '/radio', label: 'Radio', icon: 'radio' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export const ADMIN_NAV_ITEM: NavItem = { href: '/admin', label: 'Admin', icon: 'admin' };

/** Exact-match Home and Library so a sub-route (e.g. /library/liked)
 *  doesn't also highlight the parent link; everything else matches by
 *  prefix (e.g. /settings/profile keeps Settings active). */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === '/' || href === '/library') return pathname === href;
  return pathname.startsWith(href);
}

/** A sub page's back control: where it goes when the page before was not
 *  Ember's, and whether the page draws it itself on a phone. */
export interface BackRoute {
  fallbackHref: string;
  /** False where the page already has its own phone back (Settings'
   *  section header, the What's new entry bar). */
  phone: boolean;
}

/** The sub pages that get the shared back button: in the desktop top bar
 *  beside the search box, and at the top left of the page on a phone. The
 *  tabs (Home, Search, Library, Radio, Settings, What's new, Admin) never
 *  do, nor do pages that carry their own back in a different shape (the
 *  guitar tab stage, the transfer wizard's bar, Admin's section bar). */
const BACK_ROUTES: { match: RegExp; fallbackHref: string; phone?: false }[] = [
  { match: /^\/playlist\/[^/]+/, fallbackHref: '/library' },
  { match: /^\/library\/(liked|recent)\/?$/, fallbackHref: '/library' },
  { match: /^\/album\/[^/]+/, fallbackHref: '/' },
  { match: /^\/artist\/[^/]+/, fallbackHref: '/' },
  { match: /^\/track\/[^/]+/, fallbackHref: '/' },
  { match: /^\/chart\/[^/]+/, fallbackHref: '/' },
  { match: /^\/mix\/[^/]+/, fallbackHref: '/' },
  { match: /^\/settings\/[^/]+/, fallbackHref: '/settings', phone: false },
  { match: /^\/whats-new\/[^/]+/, fallbackHref: '/whats-new', phone: false },
];

/** The back button this page gets, or null for a top level page. */
export function backRouteFor(pathname: string | null): BackRoute | null {
  if (!pathname) return null;
  const rule = BACK_ROUTES.find((r) => r.match.test(pathname));
  return rule ? { fallbackHref: rule.fallbackHref, phone: rule.phone !== false } : null;
}
