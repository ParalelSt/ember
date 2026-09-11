import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_ITEM, BASE_NAV, isNavActive } from './nav';

describe('isNavActive', () => {
  it('exact-matches Home', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/', '/search')).toBe(false);
  });

  it('exact-matches Library, not a sub-route', () => {
    expect(isNavActive('/library', '/library')).toBe(true);
    expect(isNavActive('/library', '/library/liked')).toBe(false);
  });

  it('prefix-matches everything else, e.g. Settings sub-routes', () => {
    expect(isNavActive('/settings', '/settings/profile')).toBe(true);
    expect(isNavActive('/settings', '/settings')).toBe(true);
  });
});

describe('BASE_NAV', () => {
  it('lists Home, Search, Library, Settings in order with their hrefs', () => {
    expect(BASE_NAV.map((item) => [item.href, item.label])).toEqual([
      ['/', 'Home'],
      ['/search', 'Search'],
      ['/library', 'Library'],
      ['/settings', 'Settings'],
    ]);
  });
});

describe('ADMIN_NAV_ITEM', () => {
  it('is the Admin link', () => {
    expect(ADMIN_NAV_ITEM).toEqual({ href: '/admin', label: 'Admin', icon: 'admin' });
  });
});
