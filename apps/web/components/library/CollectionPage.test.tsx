import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CollectionPage, type CollectionPageProps } from './CollectionPage';
import type { Track } from '@/types/track';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function track(id: string, title: string): Track {
  return {
    id: `t:${id}`,
    source: 'youtube',
    sourceId: id,
    title,
    artist: 'Aftertone',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: '',
  };
}

const noop = () => {};

function props(over: Partial<CollectionPageProps> = {}): CollectionPageProps {
  return {
    eyebrow: 'Playlist',
    title: 'Liked songs',
    meta: ['2 songs'],
    cover: { src: null, icon: 'heart' },
    tracks: [track('a', 'Slow Static'), track('b', 'Harbor Lights')],
    context: { type: 'liked' },
    playback: { play: noop, shuffle: noop, shuffleOn: false, active: false },
    download: null,
    trackActions: { currentId: null, isPlaying: false, likedIds: new Set(), onPlay: noop, onToggle: noop },
    emptyMessage: 'No liked songs yet.',
    ...over,
  };
}

const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('CollectionPage', () => {
  it('stacks header, action bar and list in that order', () => {
    render(<CollectionPage {...props()} />);
    const header = screen.getByTestId('collection-header');
    const meta = screen.getByTestId('collection-meta');
    const bar = screen.getByTestId('action-bar');
    const firstRow = screen.getByText('Slow Static');

    expect(follows(meta, bar)).toBe(true);
    expect(follows(bar, firstRow)).toBe(true);
    // Beside: the action bar lives inside the header's text column.
    expect(header.contains(bar)).toBe(true);
    expect(header.contains(firstRow)).toBe(false);
    expect(follows(screen.getByText('Slow Static'), screen.getByText('Harbor Lights'))).toBe(true);
  });

  it('puts a stack gap between the header and the list, with no margins on either', () => {
    render(<CollectionPage {...props()} />);
    const header = screen.getByTestId('collection-header');
    const stack = header.parentElement!;
    expect(stack.className).toContain('gap-stack');
    expect(stack.className).toContain('flex-col');
    expect(stack.children).toHaveLength(2);
    expect(stack.children[0]).toBe(header);
    expect(stack.children[1].contains(screen.getByText('Slow Static'))).toBe(true);
    expect(screen.getByTestId('action-bar').className).toContain('gap-cluster');
    expect(screen.getByTestId('action-bar').className).not.toMatch(/(^|\s)m[tbxy]?-/);
  });

  it('keeps the page children after the stack', () => {
    render(
      <CollectionPage {...props()}>
        <div>Add songs</div>
      </CollectionPage>,
    );
    const stack = screen.getByTestId('collection-header').parentElement!;
    expect(follows(stack, screen.getByText('Add songs'))).toBe(true);
    expect(stack.contains(screen.getByText('Add songs'))).toBe(false);
  });

  it('shows the empty state where the list goes', () => {
    render(<CollectionPage {...props({ tracks: [] })} />);
    expect(follows(screen.getByTestId('action-bar'), screen.getByText('No liked songs yet.'))).toBe(true);
  });

  it('drops the action bar entirely when there is nothing to put in it', () => {
    render(<CollectionPage {...props({ tracks: [], hideActions: true })} />);
    expect(screen.queryByTestId('action-bar')).toBeNull();
  });

  it('keeps Play and Shuffle wired', () => {
    const play = vi.fn();
    const shuffle = vi.fn();
    render(<CollectionPage {...props({ playback: { play, shuffle, shuffleOn: false, active: false } })} />);
    within(screen.getByTestId('action-bar')).getByRole('button', { name: 'Play' }).click();
    screen.getByRole('button', { name: 'Shuffle play' }).click();
    expect(play).toHaveBeenCalledTimes(1);
    expect(shuffle).toHaveBeenCalledTimes(1);
  });
});
