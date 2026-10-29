import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_ITEM, BASE_NAV, backRouteFor, isNavActive } from './nav';

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
  it('lists Home, Search, Library, Radio, Settings in order with their hrefs', () => {
    expect(BASE_NAV.map((item) => [item.href, item.label])).toEqual([
      ['/', 'Home'],
      ['/search', 'Search'],
      ['/library', 'Library'],
      ['/radio', 'Radio'],
      ['/settings', 'Settings'],
    ]);
  });
});

describe('ADMIN_NAV_ITEM', () => {
  it('is the Admin link', () => {
    expect(ADMIN_NAV_ITEM).toEqual({ href: '/admin', label: 'Admin', icon: 'admin' });
  });
});

describe('backRouteFor', () => {
  it('top level tabs get no back button', () => {
    for (const p of ['/', '/search', '/library', '/radio', '/settings', '/whats-new', '/admin', '/admin/users', '/tabs/t1', '/transfer', null]) {
      expect(backRouteFor(p)).toBeNull();
    }
  });

  it('collection and detail pages get one, on both sizes', () => {
    expect(backRouteFor('/playlist/abc')).toEqual({ fallbackHref: '/library', phone: true });
    expect(backRouteFor('/library/liked')).toEqual({ fallbackHref: '/library', phone: true });
    expect(backRouteFor('/library/recent')).toEqual({ fallbackHref: '/library', phone: true });
    for (const p of ['/album/a1', '/artist/x', '/track/t1', '/chart/top-50', '/mix/rock']) {
      expect(backRouteFor(p)).toEqual({ fallbackHref: '/', phone: true });
    }
  });

  it('Settings sections and a What\'s new entry keep their own phone back, so only the top bar gets it', () => {
    expect(backRouteFor('/settings/uploads')).toEqual({ fallbackHref: '/settings', phone: false });
    expect(backRouteFor('/settings/appearance')).toEqual({ fallbackHref: '/settings', phone: false });
    expect(backRouteFor('/whats-new/0.7.12')).toEqual({ fallbackHref: '/whats-new', phone: false });
  });

  it('does not match look-alike paths', () => {
    expect(backRouteFor('/library/likedx')).toBeNull();
    expect(backRouteFor('/playlists')).toBeNull();
    expect(backRouteFor('/album')).toBeNull();
  });
});
