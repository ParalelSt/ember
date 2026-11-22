import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NewReleasesRow } from './NewReleasesRow';
import type { NewReleaseItem } from '@/lib/newReleasesView';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

const item = (id: string, from: 'liked' | 'similar', over: Partial<NewReleaseItem> = {}): NewReleaseItem => ({
  browseId: `MPREb_${id}`,
  title: `Title ${id}`,
  kind: 'album',
  artist: `Artist ${id}`,
  artistId: `UC${id}`,
  artworkUrl: null,
  year: 2026,
  firstSeenAt: '2026-11-20T00:00:00.000Z',
  from,
  ...over,
});

const mixed = () => [item('a', 'liked'), item('b', 'liked'), item('c', 'similar')];
const titles = () => within(screen.getByRole('region', { name: 'New releases' })).getAllByRole('listitem').map((li) => li.textContent);

describe('NewReleasesRow', () => {
  it('renders nothing at all for an empty list', () => {
    const { container } = render(<NewReleasesRow releases={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a tile links to its album and reads "Album · Artist"', () => {
    render(<NewReleasesRow releases={[item('a', 'liked')]} />);
    expect(screen.getByRole('link', { name: /Title a/ })).toHaveAttribute('href', `/album/${encodeURIComponent('MPREb_a')}`);
    expect(screen.getByText('Album · Artist a')).toBeInTheDocument();
  });

  it('names singles and EPs', () => {
    render(<NewReleasesRow releases={[item('a', 'liked', { kind: 'single' }), item('b', 'liked', { kind: 'ep' })]} />);
    expect(screen.getByText('Single · Artist a')).toBeInTheDocument();
    expect(screen.getByText('EP · Artist b')).toBeInTheDocument();
  });

  it('keeps the order it is given, liked tiles before suggested ones', () => {
    render(<NewReleasesRow releases={mixed()} />);
    expect(titles()).toEqual([
      expect.stringContaining('Title a'),
      expect.stringContaining('Title b'),
      expect.stringContaining('Title c'),
    ]);
  });

  it('has no switch with one group, liked only or similar only', () => {
    const { unmount } = render(<NewReleasesRow releases={[item('a', 'liked')]} />);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<NewReleasesRow releases={[item('c', 'similar')]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has the switch with two groups, starting on All', () => {
    render(<NewReleasesRow releases={mixed()} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Your artists', 'Similar']);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toHaveLength(3);
  });

  it('Your artists and Similar each leave only their own tiles, and All brings every tile back', () => {
    render(<NewReleasesRow releases={mixed()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Your artists' }));
    expect(titles().join('|')).toMatch(/Title a.*Title b/);
    expect(titles()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Similar' }));
    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain('Title c');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(titles()).toHaveLength(3);
  });

  it('does not remember the choice between visits', () => {
    const first = render(<NewReleasesRow releases={mixed()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Similar' }));
    first.unmount();
    render(<NewReleasesRow releases={mixed()} />);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(titles()).toHaveLength(3);
  });

  it('switch buttons are at least 40px tall', () => {
    render(<NewReleasesRow releases={mixed()} />);
    for (const b of screen.getAllByRole('button')) expect(b).toHaveClass('min-h-10');
  });

  it('the desktop variant uses the large tile (title link beside a hidden cover link)', () => {
    const { unmount } = render(<NewReleasesRow releases={[item('a', 'liked')]} />);
    expect(document.querySelector('a[aria-hidden]')).toBeNull();
    unmount();
    render(<NewReleasesRow releases={[item('a', 'liked')]} isDesktop />);
    expect(document.querySelector('a[aria-hidden]')).not.toBeNull();
  });
});
