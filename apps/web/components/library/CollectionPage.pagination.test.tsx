import { useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CollectionPage, pageItems, type CollectionPageProps } from './CollectionPage';
import type { Track } from '@/types/track';

vi.mock('@/components/ui/dropdown-menu', () => import('@/test-utils/dropdownMenuMock'));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

const song = (n: number): Track => ({
  id: `t:${n}`, source: 'youtube', sourceId: String(n), title: `Song ${n}`, artist: 'Aftertone',
  artistId: null, album: null, albumId: null, durationSec: 200, artworkUrl: null, streamUrl: '',
});
const songs = (n: number) => Array.from({ length: n }, (_, i) => song(i + 1));
const noop = () => {};

function props(tracks: Track[], onPlay: (...a: unknown[]) => void = noop): CollectionPageProps {
  return {
    eyebrow: 'Playlist', title: 'Big', meta: [], cover: { src: null, icon: 'heart' }, tracks,
    context: { type: 'liked' },
    playback: { play: noop, shuffle: noop, shuffleOn: false, active: false },
    download: null,
    trackActions: { currentId: null, isPlaying: false, likedIds: new Set(), onPlay, onToggle: noop },
    emptyMessage: 'none',
  };
}
const rows = () => screen.getAllByTestId('track-row');
const ranks = () => rows().map((r) => r.querySelector('span.tabular-nums')?.textContent);

afterEach(() => vi.restoreAllMocks());

describe('CollectionPage pagination', () => {
  it('pages a 128-song list at 50 and shows no pager for 30', () => {
    const { unmount } = render(<CollectionPage {...props(songs(128))} />);
    expect(rows()).toHaveLength(50);
    expect(screen.getByTestId('pager-range')).toHaveTextContent('Songs 1 to 50 of 128');
    unmount();
    render(<CollectionPage {...props(songs(30))} />);
    expect(rows()).toHaveLength(30);
    expect(screen.queryByTestId('pager')).toBeNull();
  });

  it('page 2 shows songs 51 to 100 with ranks 51 to 100', () => {
    render(<CollectionPage {...props(songs(128))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(rows()).toHaveLength(50);
    expect(ranks()[0]).toBe('51');
    expect(ranks()[49]).toBe('100');
    expect(screen.getByTestId('pager-range')).toHaveTextContent('Songs 51 to 100 of 128');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(rows()).toHaveLength(28);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('playing a song on page 2 queues the whole list', () => {
    const onPlay = vi.fn();
    const all = songs(128);
    render(<CollectionPage {...props(all, onPlay)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    fireEvent.click(rows()[0]);
    expect(onPlay).toHaveBeenCalledTimes(1);
    const [played, queue] = onPlay.mock.calls[0] as [Track, Track[]];
    expect(played.title).toBe('Song 51');
    expect(queue).toHaveLength(128);
    expect(queue).toEqual(all);
  });

  it('searching resets to page 1 and queues the filtered list', () => {
    const onPlay = vi.fn();
    render(<CollectionPage {...props(songs(128), onPlay)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    fireEvent.change(screen.getByLabelText('Search in this list', { selector: 'input' }), { target: { value: 'Song 1' } });
    // 40 matches (1, 10-19, 100-128 minus none): one page, so no pager.
    expect(screen.queryByTestId('pager')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search in this list', { selector: 'input' }), { target: { value: 'Aftertone' } });
    // Every song matches by artist: still 128, back on page 1.
    expect(screen.getByTestId('pager-range')).toHaveTextContent('Songs 1 to 50 of 128');
    expect(ranks()[0]).toBe('1');
  });

  it('a page change scrolls the list anchor, not first render or a no-op click', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(<CollectionPage {...props(songs(128))} />);
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    expect(spy.mock.instances[0]).toBe(screen.getByTestId('pager').parentElement);
  });

  it('clamps the page when the list shrinks under it', () => {
    function Harness() {
      const [list, setList] = useState(songs(101));
      return (
        <>
          <button onClick={() => setList((l) => l.slice(0, 50))}>shrink-to-one-page</button>
          <button onClick={() => setList((l) => l.slice(0, 51 + 50))}>same</button>
          <CollectionPage {...props(list)} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(rows()).toHaveLength(1);
    fireEvent.click(screen.getByText('shrink-to-one-page'));
    expect(rows()).toHaveLength(50);
    expect(screen.queryByTestId('pager')).toBeNull();
  });

  it('pageItems collapses long runs', () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(1, 9)).toEqual([1, 2, null, 9]);
    expect(pageItems(5, 9)).toEqual([1, null, 4, 5, 6, null, 9]);
    expect(pageItems(9, 9)).toEqual([1, null, 8, 9]);
  });
});
