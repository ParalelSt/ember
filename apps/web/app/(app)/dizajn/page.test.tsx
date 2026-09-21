import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import DizajnPage from './page';
import { BAR_SPACING_OPTIONS, BAR_SPACING_RECOMMENDED } from '@/components/library/options/barspacing';

// base-ui's Slider cannot render under happy-dom (see SeekBar.test.tsx);
// the gallery only needs the seek line to be there, with its data-slots.
vi.mock('@/components/ui/slider', () => ({
  Slider: () => (
    <div data-slot="slider">
      <div data-slot="slider-range" />
      <div data-slot="slider-thumb" />
    </div>
  ),
}));

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('DizajnPage (phone player spacing only)', () => {
  it('shows one frame per spacing option and nothing else from the old gallery', () => {
    render(<DizajnPage />);
    const options = screen.getAllByTestId('barspacing-option');
    expect(options.map((o) => o.dataset.option)).toEqual(BAR_SPACING_OPTIONS.map((o) => o.id));
    expect(screen.queryByText('Design gallery')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });

  it('every frame is the REAL phone bar with the same layout: play and next', () => {
    render(<DizajnPage />);
    for (const frame of screen.getAllByTestId('barspacing-frame')) {
      const bar = within(frame).getByTestId('phone-player-bar');
      expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Play', 'Next']);
      expect(within(bar).getByTestId('phone-play-disc')).toHaveClass('size-10');
    }
  });

  it('only the wrapper spacing differs, and the shipped one changes nothing', () => {
    render(<DizajnPage />);
    const frames = screen.getAllByTestId('barspacing-frame');
    const classes = frames.map((f) => f.className);
    expect(new Set(classes).size).toBe(classes.length);
    expect(frames[BAR_SPACING_OPTIONS.findIndex((o) => o.id === 'aligned')].className).toBe('');
    // Spacing only: no option touches size or colour.
    for (const c of classes) expect(c).not.toMatch(/:(size|w|h|bg|text|border|opacity)-/);
  });

  it('marks exactly one option as recommended', () => {
    render(<DizajnPage />);
    const tagged = screen.getAllByText('Recommended').map((t) => t.closest('[data-testid="barspacing-option"]'));
    expect(tagged).toHaveLength(1);
    expect((tagged[0] as HTMLElement).dataset.option).toBe(BAR_SPACING_RECOMMENDED);
  });
});
