import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from '@testing-library/react';

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
});
