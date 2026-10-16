import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LibraryCover } from './LibraryCover';
import { LIBRARY_BADGES } from '@/components/library/libraryIcons';

const arts = (n: number) => Array.from({ length: n }, (_, i) => `https://img.test/${i}.jpg`);
const box = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('LibraryCover', () => {
  it.each([
    ['recent', '#246373', '#88bfc3'],
    ['uploads', '#a16a2c', '#e6c785'],
    ['downloaded', '#245d46', '#80bba0'],
  ] as const)('%s is its own gradient with a white glyph, whatever songs it has', (badge, from, to) => {
    for (const songs of [[], arts(2), arts(6)]) {
      const { container, unmount } = render(<LibraryCover cover={{ kind: 'badge', badge, arts: songs }} />);
      const el = box(container);
      expect(el).toHaveAttribute('data-library-cover', badge);
      expect(el.querySelector('img')).toBeNull();
      const tile = el.querySelector('[data-glyph-tile]') as HTMLElement;
      expect(tile.style.background).toContain('135deg');
      expect(tile.getAttribute('style')).toContain(from);
      expect(tile.getAttribute('style')).toContain(to);
      expect(tile.style.color).toBe('#ffffff');
      expect(tile.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('takes its glyphs from the one map in components/library/libraryIcons', () => {
    expect(Object.keys(LIBRARY_BADGES).sort()).toEqual(['downloaded', 'recent', 'uploads']);
  });

  it('Liked songs keeps the white heart', () => {
    const { container } = render(<LibraryCover cover={{ kind: 'liked' }} className="size-14" />);
    expect(box(container)).toHaveClass('size-14');
    expect(container.querySelector('[data-liked-heart]')).toHaveAttribute('fill', '#ffffff');
  });

  it('a playlist shows its own cover, its four-cover mosaic, or the neutral note tile', () => {
    const one = render(<LibraryCover cover={{ kind: 'art', src: 'https://img.test/own.jpg' }} />);
    expect(one.container.querySelector('img')).toHaveAttribute('src', 'https://img.test/own.jpg');
    one.unmount();
    const four = render(<LibraryCover cover={{ kind: 'art', src: null, mosaic: arts(4) }} />);
    expect(four.container.querySelectorAll('[data-mosaic] img')).toHaveLength(4);
    four.unmount();
    const none = render(<LibraryCover cover={{ kind: 'art', src: null }} />);
    expect(none.container.querySelector('img')).toBeNull();
    expect(none.container.querySelector('[data-neutral-cover] svg')).not.toBeNull();
  });
});
