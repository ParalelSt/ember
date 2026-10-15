import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QuickGrid } from './QuickGrid';
import type { QuickPick } from '@/lib/home';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const LONG = 'Supercalifragilisticexpialidocious Night Drive Mix Extended Volume Two';
const items: QuickPick[] = [
  { key: 'liked', title: 'Liked songs', href: '/library/liked', src: null, icon: 'heart' },
  { key: 'p1', title: LONG, href: '/playlist/p1', src: '/art/p1.jpg', icon: null },
  { key: 's1', title: 'Friday drive', href: '/session/s1', src: null, icon: 'car' },
];

describe('QuickGrid', () => {
  it('is a two-column grid of compact tiles that open each collection', () => {
    render(<QuickGrid items={items} />);
    const list = screen.getByRole('list', { name: 'Your collections' });
    expect(list).toHaveClass('grid', 'grid-cols-2');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Liked songs' })).toHaveAttribute('href', '/library/liked');
    expect(screen.getByRole('link', { name: LONG })).toHaveAttribute('href', '/playlist/p1');
    expect(screen.getByRole('link', { name: 'Friday drive' })).toHaveAttribute('href', '/session/s1');
  });

  it('gives each tile a fixed 56px height with the cover on the left', () => {
    render(<QuickGrid items={items} />);
    const link = screen.getByRole('link', { name: LONG });
    expect(link).toHaveClass('flex', 'h-14', 'rounded-[6px]', 'bg-secondary', 'overflow-hidden');
    const cover = link.firstElementChild as HTMLElement;
    expect(cover).toHaveClass('size-14', 'shrink-0');
    expect(cover.querySelector('img')).toHaveAttribute('src', '/art/p1.jpg');
  });

  it('clamps a long name to two bold lines inside its own tile', () => {
    render(<QuickGrid items={items} />);
    const name = screen.getByText(LONG);
    expect(name).toHaveClass('line-clamp-2', 'break-words', 'min-w-0', 'font-bold');
  });

  it('draws Liked songs with the sound-wave heart cover', () => {
    render(<QuickGrid items={items} />);
    const cover = screen.getByRole('link', { name: 'Liked songs' }).firstElementChild as HTMLElement;
    expect(cover.querySelector('[data-liked-cover]')).not.toBeNull();
  });

  it('draws a playlist with four song covers as a 2x2 mosaic flush left', () => {
    const mosaic = ['a', 'b', 'c', 'd'].map((x) => `/art/${x}.jpg`);
    render(<QuickGrid items={[{ key: 'p2', title: 'Mosaic', href: '/playlist/p2', src: null, icon: null, mosaic }]} />);
    const cover = screen.getByRole('link', { name: 'Mosaic' }).firstElementChild as HTMLElement;
    expect(cover).toHaveClass('size-14', 'rounded-none');
    expect(cover.querySelector('[data-mosaic]')).not.toBeNull();
    expect([...cover.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(mosaic);
  });

  it('renders nothing with no items', () => {
    const { container } = render(<QuickGrid items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('QuickGrid, desktop (the owner\'s "chips4" pick)', () => {
  const desk: QuickPick[] = [
    { key: 'liked', title: 'Liked songs', href: '/library/liked', src: null, icon: 'heart', ref: { kind: 'liked' } },
    { key: 's1', title: 'Friday drive', href: '/session/s1', src: null, icon: 'car' },
    { key: 'p1', title: 'Road trip', href: '/playlist/p1', src: null, icon: null, mosaic: ['/a', '/b', '/c', '/d'], ref: { kind: 'playlist', id: 'p1' } },
  ];

  it('is four columns of 64px tiles on a faint wash that lightens on hover', () => {
    render(<QuickGrid variant="desktop" items={desk} />);
    expect(screen.getByRole('list', { name: 'Your collections' })).toHaveClass('grid', 'grid-cols-4');
    const link = screen.getByRole('link', { name: 'Road trip' });
    expect(link).toHaveClass('h-16', 'bg-foreground/10', 'group-hover:bg-foreground/20');
    expect(link.firstElementChild).toHaveClass('size-16');
    expect(link.querySelector('[data-mosaic]')).not.toBeNull();
    // Liked songs wears its sound-wave heart cover.
    expect(screen.getByRole('link', { name: 'Liked songs' }).querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Road trip')).toHaveClass('line-clamp-2', 'font-bold');
  });

  it('shows a play button on hover that plays the collection, none for a carlist', () => {
    const onPlay = vi.fn();
    render(<QuickGrid variant="desktop" items={desk} onPlay={onPlay} isPlaying={() => false} />);
    const play = screen.getByRole('button', { name: 'Play Road trip' });
    expect(play).toHaveClass('opacity-0', 'group-hover:opacity-100', 'right-[10px]', 'top-row');
    // No translate to centre it: pressing the button nudges it by one.
    expect(play.className).not.toMatch(/-translate-y-1\/2/);
    expect(play.closest('a')).toBeNull();
    fireEvent.click(play);
    expect(onPlay).toHaveBeenCalledWith(desk[2]);
    expect(screen.getByRole('button', { name: 'Play Liked songs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play Friday drive' })).toBeNull();
  });

  it('keeps the button up as Pause on the collection that is playing', () => {
    render(<QuickGrid variant="desktop" items={desk} onPlay={() => {}} isPlaying={(i) => i.key === 'liked'} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveClass('opacity-100');
  });
});
