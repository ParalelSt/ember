import type { ComponentProps, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MobileNav } from './MobileNav';
import { NavLinks } from './NavLinks';
import { CarRail } from './CarRail';
import { installNavigationIntent, reloadForChunkFailure, resetChunkReloadForTests } from '@/lib/chunkReload';

/** The owner's "second search page" (Android, 2026-11-03): the Search tab
 *  only opens the search sheet, but it is an <a href="/search">, and the
 *  stale-chunk reload remembers the last internal link pressed as "where
 *  the user was headed". So a chunk failure in the 10 s after opening the
 *  sheet (pressing Back on the full-screen player, say) reloaded the app
 *  onto the /search PAGE. A Search link that opens the sheet is not a
 *  navigation and must not become the reload's target. */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const reload = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  installNavigationIntent();
  resetChunkReloadForTests();
  window.sessionStorage.clear();
  reload.mockClear();
  assign.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A chunk fails to load while the listener is still on Home. */
function chunkFailsOnHome() {
  const origin = window.location.origin;
  vi.stubGlobal('location', { ...window.location, origin, pathname: '/', search: '', hash: '', reload, assign });
  return reloadForChunkFailure();
}

const navs: [string, () => ReactElement][] = [
  ['the phone bottom nav', () => <MobileNav onSearchClick={() => {}} />],
  [
    'the sidebar and drawer links',
    () => (
      <NavLinks
        items={[{ href: '/search', label: 'Search', icon: 'search' }]}
        activePath="/"
        onSearchClick={() => {}}
      />
    ),
  ],
  ['the car rail', () => <CarRail onSearchClick={() => {}} />],
];

describe('the Search link that opens the search sheet', () => {
  it.each(navs)('in %s is not where a stale-chunk reload goes', (_, ui) => {
    render(ui());
    fireEvent.click(screen.getByRole('link', { name: 'Search' }));

    expect(chunkFailsOnHome()).toBe(true);
    expect(assign).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a modified click, which really opens /search, still is', () => {
    render(<MobileNav onSearchClick={() => {}} />);
    fireEvent.click(screen.getByRole('link', { name: 'Search' }), { ctrlKey: true });

    expect(chunkFailsOnHome()).toBe(true);
    expect(assign).toHaveBeenCalledWith('/search');
  });

  it('a link that navigates still is', () => {
    render(<MobileNav onSearchClick={() => {}} />);
    fireEvent.click(screen.getByRole('link', { name: 'Library' }));

    expect(chunkFailsOnHome()).toBe(true);
    expect(assign).toHaveBeenCalledWith('/library');
  });
});
