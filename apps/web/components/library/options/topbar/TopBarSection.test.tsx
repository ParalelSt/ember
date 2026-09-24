import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TopBarSection, TOPBAR_SCROLL } from '@/components/library/options/topbar/TopBarSection';
import { TopBarFrame } from '@/components/library/options/topbar/TopBarFrame';
import { TOPBAR_OPTIONS, TOPBAR_RECOMMENDED } from '@/components/library/options/topbar';

describe('TopBarSection', () => {
  it('draws every candidate at 1280 and 1920, at the top and scrolled, plus Midnight and Mono', () => {
    for (const candidate of TOPBAR_OPTIONS) {
      const { unmount } = render(<TopBarSection candidate={candidate} />);
      const shots = screen.getAllByTestId('topbar-shot');
      const keys = shots.map(
        (s) => `${s.dataset.width}/${s.dataset.scroll}/${s.dataset.preset}`,
      );
      expect(keys).toEqual([
        '1280/0/ember',
        '1920/0/ember',
        `1280/${TOPBAR_SCROLL}/ember`,
        `1920/${TOPBAR_SCROLL}/ember`,
        `1280/${TOPBAR_SCROLL}/midnight`,
        `1280/${TOPBAR_SCROLL}/mono`,
      ]);
      for (const frame of screen.getAllByTestId('topbar-frame')) {
        expect(frame).toHaveAttribute('data-candidate', candidate.id);
      }
      unmount();
    }
  });

  it('themes the Midnight and Mono shots with inline theme variables', () => {
    render(<TopBarSection candidate={TOPBAR_OPTIONS[0]} />);
    for (const shot of screen.getAllByTestId('topbar-shot')) {
      const wrapper = shot.querySelector('[style*="--background"]');
      if (shot.dataset.preset === 'ember') expect(wrapper).toBeNull();
      else expect(wrapper).not.toBeNull();
    }
  });

  it('marks exactly one candidate Recommended, with a reason', () => {
    let badges = 0;
    let reasons = 0;
    for (const candidate of TOPBAR_OPTIONS) {
      const { unmount } = render(<TopBarSection candidate={candidate} />);
      badges += screen.queryAllByTestId('topbar-recommended-badge').length;
      reasons += screen.queryAllByTestId('topbar-recommended-reason').length;
      unmount();
    }
    expect(badges).toBe(1);
    expect(reasons).toBe(1);
    expect(TOPBAR_OPTIONS.filter((c) => c.id === TOPBAR_RECOMMENDED)).toHaveLength(1);
  });

  it('has four distinct candidates with a name and description', () => {
    expect(TOPBAR_OPTIONS.map((c) => c.id)).toEqual(['float', 'frosted', 'solid', 'now']);
    for (const c of TOPBAR_OPTIONS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe('TopBarFrame', () => {
  it('starts the scrollbar at the top for a to c, 80px down for "As it is"', () => {
    for (const candidate of TOPBAR_OPTIONS) {
      const { unmount } = render(<TopBarFrame candidate={candidate} scrollY={0} />);
      const bar = screen.getByTestId('topbar-scrollbar');
      expect(bar).toHaveAttribute('data-top-px', candidate.fullHeightScroller ? '0' : '80');
      expect(screen.getByText(`Scrollbar starts here, ${candidate.scrollbarTopPx}px down →`)).toBeInTheDocument();
      unmount();
    }
  });

  it('measures pill to heading at 32px at the top in every candidate (no added distance)', () => {
    for (const candidate of TOPBAR_OPTIONS) {
      const { unmount } = render(<TopBarFrame candidate={candidate} scrollY={0} />);
      const m = screen.getByTestId('topbar-measure');
      expect(m).toHaveAttribute('data-kind', 'heading-gap');
      expect(m).toHaveAttribute('data-px', '32');
      unmount();
    }
  });

  it('keeps a 16px covered band under the pill once scrolled, except "As it is"', () => {
    for (const candidate of TOPBAR_OPTIONS) {
      const { unmount } = render(<TopBarFrame candidate={candidate} scrollY={TOPBAR_SCROLL} />);
      const m = screen.getByTestId('topbar-measure');
      expect(m).toHaveAttribute('data-kind', 'band');
      expect(m).toHaveAttribute('data-px', candidate.id === 'now' ? '0' : '16');
      const bands = screen.queryAllByTestId('topbar-band');
      expect(bands).toHaveLength(candidate.id === 'now' ? 0 : 1);
      if (candidate.id !== 'now') expect(bands[0].className).toContain('h-block');
      unmount();
    }
  });

  it('draws the page heading once, and the bar once (a to c also reserve its height in flow)', () => {
    for (const candidate of TOPBAR_OPTIONS) {
      const { unmount } = render(<TopBarFrame candidate={candidate} scrollY={0} />);
      expect(screen.getAllByTestId('topbar-heading')).toHaveLength(1);
      expect(screen.getAllByTestId('topbar-bar')).toHaveLength(1);
      expect(screen.getAllByTestId('topbar-pill')).toHaveLength(1);
      unmount();
    }
  });

  it('frosted shows its hairline only once scrolled', () => {
    const frosted = TOPBAR_OPTIONS.find((c) => c.id === 'frosted')!;
    const top = render(<TopBarFrame candidate={frosted} scrollY={0} />);
    expect(within(top.container).getByTestId('topbar-bar').className).toContain('border-transparent');
    top.unmount();
    render(<TopBarFrame candidate={frosted} scrollY={TOPBAR_SCROLL} />);
    expect(screen.getByTestId('topbar-bar').className).toContain('border-border');
  });
});
