import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DizajnPage from './page';
import { SHELF_OPTIONS, RHYTHM_OPTIONS, ACTIONS_OPTIONS } from '@/components/library/options';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// @base-ui's Dialog reaches the repo root's hoisted React 18 through its own
// node_modules copy (see SearchOverlayContainer.test.tsx): render plain
// elements for the chrome so this test is about page wiring, not base-ui's
// portal/focus machinery.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

beforeEach(() => {
  window.localStorage.clear();
});

describe('DizajnPage', () => {
  it('renders every section with no network', () => {
    render(<DizajnPage />);

    expect(screen.getByText('Instant search overlay')).toBeInTheDocument();
    expect(screen.getByText('Loading skeletons')).toBeInTheDocument();
    expect(screen.getByText('Collection page rhythm')).toBeInTheDocument();
    expect(screen.getByText('Library playlists, style options')).toBeInTheDocument();
  });

  it('renders each overlay state on demand from mock data', async () => {
    render(<DizajnPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Empty, with recents' }));
    expect(await screen.findByText('Midnight Drive')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Searching' }));
    expect(await screen.findByText('Searching…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Results' }));
    expect(await screen.findByText('Second Wind')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Offline' }));
    expect(
      await screen.findByText('No connection. This will run when you are back online.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rate limited' }));
    expect(await screen.findByText('Searching too fast, one moment.')).toBeInTheDocument();
  });

  it('renders the mock playlists, including the artwork-less and downloaded ones, for every option', () => {
    for (const option of SHELF_OPTIONS) {
      const { unmount } = render(<DizajnPage />);
      fireEvent.click(screen.getByRole('radio', { name: option.name }));

      expect(screen.getAllByText('Sunday Mornings').length).toBeGreaterThan(0); // no artwork
      expect(screen.getAllByText('Gym').length).toBeGreaterThan(0); // downloaded badge
      unmount();
    }
  });

  it('switches options with the picker and persists the choice to localStorage', async () => {
    render(<DizajnPage />);

    const denseList = SHELF_OPTIONS.find((o) => o.id === 'dense-list')!;
    fireEvent.click(screen.getByRole('radio', { name: denseList.name }));

    expect(screen.getAllByText(denseList.name).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(window.localStorage.getItem('dizajn-shelf-option')).toBe('dense-list'),
    );
  });

  it('restores the saved option on mount', () => {
    window.localStorage.setItem('dizajn-shelf-option', 'cover-led');
    render(<DizajnPage />);

    expect(screen.getByRole('radio', { name: 'Cover-led', checked: true })).toBeInTheDocument();
  });

  describe('Collection page rhythm section', () => {
    it('renders both pickers with every option as a radio, correctly checked', () => {
      render(<DizajnPage />);

      for (const o of RHYTHM_OPTIONS) {
        const radio = screen.getByRole('radio', { name: o.name });
        expect(radio).toHaveAttribute('aria-checked', o.id === RHYTHM_OPTIONS[0].id ? 'true' : 'false');
      }
      for (const o of ACTIONS_OPTIONS) {
        const radio = screen.getByRole('radio', { name: o.name });
        expect(radio).toHaveAttribute('aria-checked', o.id === ACTIONS_OPTIONS[0].id ? 'true' : 'false');
      }

      // Two preview instances (phone + desktop) for the default combination.
      expect(screen.getAllByTestId('rhythm-preview')).toHaveLength(2);
      expect(screen.getByText('Phone (390px)')).toBeInTheDocument();
      expect(screen.getByText('Desktop')).toBeInTheDocument();
    });

    it('changes the rhythm selection on click and updates the legend', () => {
      render(<DizajnPage />);

      const legendBefore = screen.getByTestId('rhythm-legend').textContent;
      fireEvent.click(screen.getByRole('radio', { name: 'Grouped' }));

      expect(screen.getByRole('radio', { name: 'Grouped' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Even' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByTestId('rhythm-legend').textContent).not.toBe(legendBefore);
    });

    it('changes the actions selection on click', () => {
      render(<DizajnPage />);

      fireEvent.click(screen.getByRole('radio', { name: 'Below' }));

      expect(screen.getByRole('radio', { name: 'Below' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Beside' })).toHaveAttribute('aria-checked', 'false');
    });

    it('persists rhythm and actions choices to localStorage independently and round-trips them', async () => {
      render(<DizajnPage />);

      fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Below' }));

      await waitFor(() => expect(window.localStorage.getItem('dizajn-rhythm-option')).toBe('today'));
      await waitFor(() => expect(window.localStorage.getItem('dizajn-actions-option')).toBe('below'));

      window.localStorage.setItem('dizajn-rhythm-option', 'grouped');
      window.localStorage.setItem('dizajn-actions-option', 'below');
      render(<DizajnPage />);

      expect(screen.getAllByRole('radio', { name: 'Grouped', checked: true }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('radio', { name: 'Below', checked: true }).length).toBeGreaterThan(0);
    });
  });
});
