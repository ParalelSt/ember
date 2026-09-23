import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DizajnPage from './page';
import { THEME_LAYOUT_OPTIONS, THEME_STATES } from '@/components/library/options/themes';
import { THEME_PRESETS } from '@/components/library/options/themes/mock';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// A layout's Recommended badge is a second text node inside the same
// button, so its accessible name is "<name>Recommended" with no space; a
// starts-with match is what every other /dizajn picker test does for the
// same reason (see PHONE_SEARCH_RECOMMENDED usage in dizajn/sve).
function radioStartingWith(container: HTMLElement, name: string) {
  return within(container).getByRole('radio', {
    name: (accessibleName) => accessibleName.startsWith(name),
  });
}

describe('DizajnPage', () => {
  it('has the Themes question open and links to the full gallery', () => {
    render(<DizajnPage />);
    expect(screen.getByText(/Custom themes/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });

  it('renders the Layout and State pickers as radiogroups with every option', () => {
    render(<DizajnPage />);
    const layout = screen.getByRole('radiogroup', { name: 'Layout' });
    for (const o of THEME_LAYOUT_OPTIONS) {
      expect(radioStartingWith(layout, o.name)).toBeInTheDocument();
    }
    const state = screen.getByRole('radiogroup', { name: 'State' });
    for (const s of THEME_STATES) {
      expect(radioStartingWith(state, s.name)).toBeInTheDocument();
    }
  });

  it('has exactly one Recommended layout', () => {
    const recommended = THEME_LAYOUT_OPTIONS.filter((o) => o.badge === 'Recommended');
    expect(recommended).toHaveLength(1);
  });

  it('renders the themes section, once, with a live preview per frame (desktop and phone)', () => {
    render(<DizajnPage />);
    expect(screen.getAllByTestId('themes-section')).toHaveLength(1);
    expect(screen.getAllByTestId('live-theme-preview')).toHaveLength(2);
  });

  it('switches layouts with the picker: each renders its own layout testid', () => {
    render(<DizajnPage />);
    const layoutGroup = screen.getByRole('radiogroup', { name: 'Layout' });
    for (const o of THEME_LAYOUT_OPTIONS) {
      fireEvent.click(radioStartingWith(layoutGroup, o.name));
      expect(screen.getByTestId('themes-section')).toHaveAttribute('data-layout', o.id);
      expect(screen.getAllByTestId(`theme-layout-${o.id}`).length).toBeGreaterThan(0);
    }
  });

  it('switches every gallery state with the picker', () => {
    render(<DizajnPage />);
    const stateGroup = screen.getByRole('radiogroup', { name: 'State' });
    for (const s of THEME_STATES) {
      fireEvent.click(radioStartingWith(stateGroup, s.name));
      expect(screen.getByTestId('themes-section')).toHaveAttribute('data-state', s.id);
    }
  });

  it('shows the readability warning and its Fix it only on the warning state', () => {
    render(<DizajnPage />);
    expect(screen.queryByTestId('readability-finding')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Readability warning' }));
    const findings = screen.getAllByTestId('readability-finding');
    expect(findings.length).toBeGreaterThan(0);
    expect(within(findings[0]).getByRole('button', { name: 'Fix it' })).toBeInTheDocument();
  });

  it('shows a shared theme as read-only, by its owner, only on the shared state', () => {
    render(<DizajnPage />);
    // Three panels puts the colour panel straight on the desktop frame, no
    // tab to open first, so the read-only note is unambiguous either way.
    fireEvent.click(screen.getByRole('radio', { name: 'Three panels' }));
    expect(screen.queryByText(/Shared by Luka/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Using a shared theme' }));
    expect(screen.getByText(/Shared by Luka/)).toBeInTheDocument();
  });

  it('draws the five presets with the plan’s real token values', () => {
    render(<DizajnPage />);
    // Every layout's Themes content renders the presets grid; Three panels
    // puts it straight on the page with no tab to open first.
    fireEvent.click(screen.getByRole('radio', { name: 'Three panels' }));
    const options = screen.getAllByTestId('preset-option');
    expect(options.length).toBeGreaterThanOrEqual(THEME_PRESETS.length);
    for (const preset of THEME_PRESETS) {
      const el = options.find((o) => o.getAttribute('data-preset') === preset.id)!;
      expect(el).toBeTruthy();
      const swatch = el.querySelector('[data-testid="swatch"]') as HTMLElement;
      expect(swatch.getAttribute('style')).toContain(preset.vars['--background']);
      expect(swatch.getAttribute('style')).toContain(preset.vars['--ember']);
    }
  });
});
