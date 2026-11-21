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
    expect(tabs.map((t) => t.textContent)).toEqual(['Profile', 'Appearance', 'Library', 'Downloads', 'Plugins', 'Devices', 'Help']);
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/settings/library');
  });

  it('has Devices, for QR sign-in and signing out everywhere', () => {
    render(<SettingsTabs />);
    expect(screen.getByRole('link', { name: 'Devices' })).toHaveAttribute('href', '/settings/devices');
  });

  it('has Appearance right after Profile', () => {
    render(<SettingsTabs />);
    expect(screen.getByRole('link', { name: 'Appearance' })).toHaveAttribute('href', '/settings/appearance');
  });

  // Bughunt V8: at md the app sidebar already takes 240px, and a side nav of
  // its own left the page ~230px. It is the scrolling row phones use until lg.
  it('is the row across the top until lg, the side column from lg', () => {
    const { container } = render(<SettingsTabs />);
    const nav = container.querySelector('nav')!;
    expect(nav).toHaveClass('lg:w-48');
    expect(nav).not.toHaveClass('md:w-48');
    expect(nav.querySelector('ul')).toHaveClass('flex', 'lg:flex-col', 'overflow-x-auto', 'lg:overflow-visible');
  });
});
