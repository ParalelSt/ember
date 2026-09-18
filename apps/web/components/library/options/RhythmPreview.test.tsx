import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RhythmPreview, rhythmLegend } from './RhythmPreview';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx). CollectionCover doesn't render a link
// itself, but keep the mock for parity with the other options tests in
// case that changes.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('RhythmPreview', () => {
  it('renders the hero, the action bar and three mock track rows', () => {
    render(<RhythmPreview rhythm="even" actions="beside" phone={false} />);

    expect(screen.getByText('Liked songs')).toBeInTheDocument();
    expect(screen.getByText('10 songs · 38 min')).toBeInTheDocument();
    expect(screen.getByTestId('mock-action-bar')).toBeInTheDocument();
    expect(screen.getAllByTestId('mock-track-row')).toHaveLength(3);
  });

  // A later refactor must not silently collapse the three rhythm
  // candidates into one layout: pin the gap classes each one produces.
  it('gives Even, Grouped and Today different gap classes', () => {
    const { container: evenC } = render(<RhythmPreview rhythm="even" actions="beside" phone={false} />);
    const { container: groupedC } = render(<RhythmPreview rhythm="grouped" actions="beside" phone={false} />);
    const { container: todayC } = render(<RhythmPreview rhythm="today" actions="beside" phone={false} />);

    const meta = (c: HTMLElement) => c.querySelector('[data-testid="mock-meta"]')!;
    const actionBar = (c: HTMLElement) => c.querySelector('[data-testid="mock-action-bar"]')!;

    expect(meta(evenC).className).toContain('mt-cluster');
    expect(meta(groupedC).className).toContain('mt-cluster');
    expect(meta(todayC).className).toContain('mt-3');
    expect(meta(todayC).className).not.toContain('mt-cluster');

    expect(actionBar(evenC).className).toContain('mt-stack');
    expect(actionBar(groupedC).className).toContain('mt-block');
    expect(actionBar(todayC).className).toContain('mt-0');

    // Each rhythm's three combined values are distinct from the others.
    const legends = [rhythmLegend('even'), rhythmLegend('grouped'), rhythmLegend('today')];
    expect(new Set(legends).size).toBe(3);
  });

  it('gives Beside and Below different DOM placements for the action bar', () => {
    const { container: besideC } = render(<RhythmPreview rhythm="even" actions="beside" phone={false} />);
    const { container: belowC } = render(<RhythmPreview rhythm="even" actions="below" phone={false} />);

    // Beside: the action bar lives inside the header's text column
    // (min-w-0 div), a sibling of the meta line.
    const besideMeta = besideC.querySelector('[data-testid="mock-meta"]')!;
    const besideBar = besideC.querySelector('[data-testid="mock-action-bar"]')!;
    expect(besideMeta.parentElement).toBe(besideBar.parentElement);

    // Below: the action bar is a sibling of the header row itself, not of
    // the meta line, and it comes after the whole header (full width row).
    const belowMeta = belowC.querySelector('[data-testid="mock-meta"]')!;
    const belowBar = belowC.querySelector('[data-testid="mock-action-bar"]')!;
    expect(belowMeta.parentElement).not.toBe(belowBar.parentElement);
  });

  it('uses a stacked header on phone and a row header on desktop', () => {
    const { container: phoneC } = render(<RhythmPreview rhythm="even" actions="beside" phone />);
    const { container: desktopC } = render(<RhythmPreview rhythm="even" actions="beside" phone={false} />);

    const phoneRoot = phoneC.querySelector('[data-testid="rhythm-preview"]')!;
    const desktopRoot = desktopC.querySelector('[data-testid="rhythm-preview"]')!;

    expect(phoneRoot.firstElementChild!.className).toContain('flex-col');
    expect(desktopRoot.firstElementChild!.className).toContain('flex-row');
  });

  it('produces the documented legend format', () => {
    expect(rhythmLegend('even')).toBe(
      'cover to eyebrow 24 / eyebrow to title 8 / title to meta 8 / meta to actions 24 / actions to first row 24',
    );
    expect(rhythmLegend('grouped')).toBe(
      'cover to eyebrow 24 / eyebrow to title 8 / title to meta 8 / meta to actions 16 / actions to first row 32',
    );
    expect(rhythmLegend('today')).toBe(
      'cover to eyebrow 24 / eyebrow to title 8 / title to meta 12 / meta to actions 0 / actions to first row 48',
    );
  });
});
