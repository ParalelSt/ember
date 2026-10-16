import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/users' }));
const { AdminTabs } = await import('./AdminTabs');

// Bughunt V8: at md the app sidebar already takes 240px, and a side nav of
// its own left the page ~230px. It is the row across the top until lg.
describe('AdminTabs', () => {
  it('is the row across the top until lg, the side column from lg', () => {
    const { container } = render(<AdminTabs />);
    const nav = container.querySelector('nav')!;
    expect(nav).toHaveClass('lg:w-48');
    expect(nav).not.toHaveClass('md:w-48');
    expect(nav.querySelector('ul')).toHaveClass('flex', 'lg:flex-col', 'overflow-x-auto', 'lg:overflow-visible');
  });

  // Phones get the section tiles and a back arrow instead (AdminHome,
  // AdminHeader); md and up keep exactly these tabs.
  it('is hidden on a phone and shown from md up, with every section', () => {
    const { container } = render(<AdminTabs />);
    expect(container.querySelector('nav')).toHaveClass('hidden', 'md:block');
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Users', 'Invites', 'Tracks', 'Pranks', 'Backups', 'Car and Android Auto',
    ]);
    expect(screen.getByRole('link', { name: 'Users' })).toHaveClass('bg-card', 'text-foreground');
  });
});
