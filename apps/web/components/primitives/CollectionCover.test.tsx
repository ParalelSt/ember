import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CollectionCover } from './CollectionCover';

const arts = ['a', 'b', 'c', 'd'].map((x) => `https://img.test/${x}.jpg`);
const imgs = (c: HTMLElement) => [...c.querySelectorAll('img')].map((i) => i.getAttribute('src'));

describe('CollectionCover mosaic', () => {
  it('draws four song covers as a 2x2 grid', () => {
    const { container } = render(<CollectionCover src={null} icon={null} mosaic={arts} />);
    const grid = container.querySelector('[data-mosaic]');
    expect(grid).toHaveClass('grid-cols-2', 'grid-rows-2');
    expect(imgs(container)).toEqual(arts);
  });

  it('ignores a mosaic of fewer than four and shows src (or the neutral note tile)', () => {
    const { container } = render(<CollectionCover src="https://img.test/one.jpg" icon={null} mosaic={arts.slice(0, 3)} />);
    expect(container.querySelector('[data-mosaic]')).toBeNull();
    expect(imgs(container)).toEqual(['https://img.test/one.jpg']);
    const bare = render(<CollectionCover src={null} icon={null} />);
    expect(imgs(bare.container)).toEqual([]);
    expect(bare.container.firstElementChild).not.toHaveClass('cover-placeholder');
  });

  it('a playlist with no art draws the charcoal tile with a gray music note', () => {
    const { container } = render(<CollectionCover src={null} icon={null} mosaic={arts.slice(0, 3)} />);
    const tile = container.querySelector('[data-neutral-cover]') as HTMLElement;
    expect(tile.style.background).toBe('#232426');
    expect(tile.style.color).toBe('#8c8e94');
    expect(tile.querySelector('svg')).not.toBeNull();
    expect(imgs(container)).toEqual([]);
  });

  it('the hero card fallback and system icons never get the neutral tile', () => {
    expect(render(<CollectionCover src={null} icon={null} fallback="card" />).container.querySelector('[data-neutral-cover]')).toBeNull();
    const clock = render(<CollectionCover src={null} icon="clock" />).container;
    expect(clock.querySelector('[data-neutral-cover]')).toBeNull();
    expect(clock.querySelector('[data-glyph-tile]')?.getAttribute('style')).toContain('#246373');
    const upload = render(<CollectionCover src={null} icon="upload" />).container;
    expect(upload.querySelector('[data-glyph-tile]')?.getAttribute('style')).toContain('#a16a2c');
  });

  it('a system icon (Liked songs heart) wins over a mosaic', () => {
    const { container } = render(<CollectionCover src={null} icon="heart" mosaic={arts} />);
    expect(container.querySelector('[data-mosaic]')).toBeNull();
    expect(container.querySelector('[data-liked-cover]')).not.toBeNull();
  });
});
