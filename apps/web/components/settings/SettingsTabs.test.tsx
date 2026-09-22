import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/settings/library' }));
const { SettingsTabs } = await import('./SettingsTabs');

describe('SettingsTabs', () => {
  it('lists Library, where Transfer lives, and marks the open tab', () => {
    render(<SettingsTabs />);
    const tabs = screen.getAllByRole('link');
    expect(tabs.map((t) => t.textContent)).toEqual(['Profile', 'Library', 'Downloads', 'Plugins', 'Help']);
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/settings/library');
  });
});
