import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// The badge icons are provisional and live in one map: swapping an entry
// there must change every cover, so the test swaps one.
vi.mock('@/lib/libraryIcons', async (orig) => {
  const real = await orig<typeof import('@/lib/libraryIcons')>();
  const Swapped = (props: { className?: string }) => <svg data-icon="swapped" {...props} />;
  return { ...real, LIBRARY_BADGES: { ...real.LIBRARY_BADGES, uploads: { ...real.LIBRARY_BADGES.uploads, icon: Swapped } } };
});

const { LibraryCover } = await import('./LibraryCover');
const { LIBRARY_BADGES } = await import('@/lib/libraryIcons');

const arts = (n: number) => Array.from({ length: n }, (_, i) => `https://img.test/${i}.jpg`);
const box = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('LibraryCover', () => {
  it('a 2x2 mosaic of the first four song covers with the round badge in the corner', () => {
    const { container } = render(<LibraryCover cover={{ kind: 'badge', badge: 'recent', arts: arts(6) }} />);
    const el = box(container);
    expect(el).toHaveAttribute('data-library-cover', 'recent');
    expect(el).toHaveAttribute('data-look', 'mosaic');
    expect([...el.querySelectorAll('[data-mosaic] img')].map((i) => i.getAttribute('src'))).toEqual(arts(4));
    const badge = el.querySelector('[data-badge]') as HTMLElement;
    expect(badge).toHaveClass('rounded-full', 'right-[6%]', 'bottom-[6%]');
    expect(badge.style.background).not.toBe('');
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('one to three covers: the first full size, badge kept', () => {
    const { container } = render(<LibraryCover cover={{ kind: 'badge', badge: 'downloaded', arts: arts(2) }} />);
    const el = box(container);
    expect(el).toHaveAttribute('data-look', 'single');
    expect(el.querySelectorAll('img')).toHaveLength(1);
    expect(el.querySelector('img')).toHaveAttribute('src', arts(1)[0]);
    expect(el.querySelector('[data-badge]')).not.toBeNull();
  });

  it('no covers: a plain coloured tile with the glyph, no badge', () => {
    const { container } = render(<LibraryCover cover={{ kind: 'badge', badge: 'recent', arts: [] }} />);
    const el = box(container);
    expect(el).toHaveAttribute('data-look', 'plain');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('[data-badge]')).toBeNull();
    expect(el.querySelector('[data-glyph] svg')).not.toBeNull();
    expect(el.getAttribute('style')).toContain('linear-gradient');
  });

  it('takes its badge icons from the one map in lib/libraryIcons', () => {
    const { container } = render(<LibraryCover cover={{ kind: 'badge', badge: 'uploads', arts: arts(4) }} />);
    expect(box(container).querySelector('[data-badge] [data-icon="swapped"]')).not.toBeNull();
    expect(Object.keys(LIBRARY_BADGES).sort()).toEqual(['downloaded', 'recent', 'uploads']);
  });

  it('Liked songs keeps the sound-wave heart', () => {
    const { container } = render(<LibraryCover cover={{ kind: 'liked' }} className="size-14" />);
    expect(box(container)).toHaveClass('size-14');
    expect(container.querySelector('[data-liked-cover]')).not.toBeNull();
  });

  it('a playlist shows its own cover or its song mosaic', () => {
    const one = render(<LibraryCover cover={{ kind: 'art', src: 'https://img.test/own.jpg' }} />);
    expect(one.container.querySelector('img')).toHaveAttribute('src', 'https://img.test/own.jpg');
    one.unmount();
    const four = render(<LibraryCover cover={{ kind: 'art', src: null, mosaic: arts(4) }} />);
    expect(four.container.querySelectorAll('[data-mosaic] img')).toHaveLength(4);
  });
});
