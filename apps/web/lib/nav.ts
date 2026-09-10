/** The top nav's links, one place instead of copied into Sidebar and
 *  Drawer. Icons are referenced by name, not by component, so this file
 *  stays free of React and Next like the rest of lib/ (a plain Node test
 *  can import it); NavLinks maps names to icon components. */
export type NavIcon = 'home' | 'search' | 'library' | 'settings' | 'admin';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export const BASE_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/search', label: 'Search', icon: 'search' },
  { href: '/library', label: 'Library', icon: 'library' },
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
