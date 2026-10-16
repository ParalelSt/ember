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

  it('draws one solid white heart, no sound-wave bars', () => {
    const { container } = render(<LikedSongsCover />);
    const hearts = container.querySelectorAll('[data-liked-heart]');
    expect(hearts).toHaveLength(1);
    expect(hearts[0]).toHaveAttribute('fill', '#ffffff');
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('two instances use disjoint gradient and filter ids, and every url(#) resolves', () => {
    const { container } = render(
      <>
        <LikedSongsCover />
        <LikedSongsCover />
      </>,
    );
    const all = ids(container);
    expect(all.length).toBe(4);
    expect(new Set(all).size).toBe(4);
    const refs = [...container.querySelectorAll('*')]
      .flatMap((el) => [...el.attributes].map((at) => /^url\(#(.+)\)$/.exec(at.value)?.[1]))
      .filter(Boolean);
    expect(refs.length).toBe(4);
    for (const r of refs) expect(all).toContain(r);
  });
});
