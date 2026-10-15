import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LikedSongsCover } from './LikedSongsCover';

const ids = (c: HTMLElement) => [...c.querySelectorAll('[id]')].map((e) => e.id);

describe('LikedSongsCover', () => {
  it('is decorative and fills a square box', () => {
    const { container } = render(<LikedSongsCover />);
    const root = container.querySelector('[data-liked-cover]') as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveClass('aspect-square', 'size-full');
    expect(root.querySelector('svg')).toHaveAttribute('viewBox', '0 0 100 100');
  });

  it('two instances use disjoint gradient and filter ids, and every url(#) resolves', () => {
    const { container } = render(
      <>
        <LikedSongsCover />
        <LikedSongsCover />
      </>,
    );
    const all = ids(container);
    expect(all.length).toBe(6);
    expect(new Set(all).size).toBe(6);
    const refs = [...container.querySelectorAll('*')]
      .flatMap((el) => [...el.attributes].map((at) => /^url\(#(.+)\)$/.exec(at.value)?.[1]))
      .filter(Boolean);
    expect(refs.length).toBeGreaterThanOrEqual(6);
    for (const r of refs) expect(all).toContain(r);
  });

  it('auto renders all three bar densities (CSS picks one); a fixed size renders one', () => {
    const auto = render(<LikedSongsCover />).container;
    const counts = [...auto.querySelectorAll('[data-detail]')].map((g) => [g.getAttribute('data-detail'), g.querySelectorAll('line').length / 2]);
    expect(counts).toEqual([['sm', 5], ['md', 9], ['lg', 15]]);
    const fixed = render(<LikedSongsCover size="md" />).container;
    expect(fixed.querySelectorAll('[data-detail]')).toHaveLength(1);
  });
});
