import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchGapSection } from '@/components/library/options/searchgap/SearchGapSection';
import { SEARCHGAP_OPTIONS, SEARCHGAP_RECOMMENDED } from '@/components/library/options/searchgap';

describe('SearchGapSection', () => {
  it('renders every candidate, at both desktop widths, with no crash', () => {
    for (const candidate of SEARCHGAP_OPTIONS) {
      const { unmount } = render(<SearchGapSection candidate={candidate} />);
      const section = screen.getByTestId('searchgap-section');
      expect(section).toHaveAttribute('data-candidate', candidate.id);

      const frames = screen.getAllByTestId('searchgap-frame');
      expect(frames).toHaveLength(2); // 1280 and 1920
      for (const frame of frames) {
        expect(frame).toHaveAttribute('data-candidate', candidate.id);
        expect(frame).toHaveAttribute('data-gap-px', String(candidate.gapPx));
      }
      unmount();
    }
  });

  it('measures the intended gap token per candidate: 0 / 8 / 16 / 16 with the fade element', () => {
    const expected: Record<string, { gapPx: number; hasFade: boolean }> = {
      now: { gapPx: 0, hasFade: false },
      'gap-sm': { gapPx: 8, hasFade: false },
      'gap-md': { gapPx: 16, hasFade: false },
      'gap-fade': { gapPx: 16, hasFade: true },
    };
    for (const candidate of SEARCHGAP_OPTIONS) {
      const want = expected[candidate.id];
      expect(want, `unexpected candidate id ${candidate.id}`).toBeDefined();
      expect(candidate.gapPx).toBe(want.gapPx);
      expect(candidate.hasFade).toBe(want.hasFade);

      const { unmount } = render(<SearchGapSection candidate={candidate} />);
      const fades = screen.queryAllByTestId('searchgap-fade');
      if (want.hasFade) {
        expect(fades.length).toBeGreaterThan(0);
      } else {
        expect(fades).toHaveLength(0);
      }
      unmount();
    }
  });

  it('marks exactly one candidate Recommended, with a one-line reason', () => {
    let badgeCount = 0;
    let reasonCount = 0;
    for (const candidate of SEARCHGAP_OPTIONS) {
      const { unmount } = render(<SearchGapSection candidate={candidate} />);
      badgeCount += screen.queryAllByTestId('searchgap-recommended-badge').length;
      reasonCount += screen.queryAllByTestId('searchgap-recommended-reason').length;
      unmount();
    }
    expect(badgeCount).toBe(1);
    expect(reasonCount).toBe(1);
    expect(SEARCHGAP_OPTIONS.filter((c) => c.id === SEARCHGAP_RECOMMENDED)).toHaveLength(1);
  });

  it('every candidate has a distinct id and a name/description', () => {
    const ids = new Set(SEARCHGAP_OPTIONS.map((c) => c.id));
    expect(ids.size).toBe(SEARCHGAP_OPTIONS.length);
    for (const c of SEARCHGAP_OPTIONS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});
