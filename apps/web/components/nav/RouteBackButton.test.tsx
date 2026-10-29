import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
const { RouteBackButton } = await import('./RouteBackButton');

const at = (p: string, placement: 'topbar' | 'page') => {
  pathname = p;
  return render(<RouteBackButton placement={placement} />);
};

describe('RouteBackButton', () => {
  it('shows on a sub page in both places', () => {
    for (const placement of ['topbar', 'page'] as const) {
      const { unmount } = at('/playlist/p1', placement);
      expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('data-slot', 'back-button');
      unmount();
    }
  });

  it('is gone on a top level tab', () => {
    for (const p of ['/', '/library', '/radio', '/search', '/settings']) {
      const { unmount } = at(p, 'topbar');
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
      unmount();
    }
  });

  it('on a phone, leaves Settings sections to their own back', () => {
    const { unmount } = at('/settings/uploads', 'page');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    unmount();
    at('/settings/uploads', 'topbar');
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
