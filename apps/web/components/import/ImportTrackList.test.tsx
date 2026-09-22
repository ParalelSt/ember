import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { importRows } from '@/lib/import/rows';
import type { ImportItem } from '@/lib/import/types';
import type { Track } from '@/types/track';

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
const { ImportTrackList } = await import('./ImportTrackList');

const track = (id: string): Track => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title: `Track ${id}`,
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
});
const item = (position: number, status: ImportItem['status'], videoId: string | null = null): ImportItem => ({
  id: `i${position}`,
  position,
  status,
  source: { position, title: `Source ${position}`, artists: ['A'], artist: 'A', durationMs: 180_000, explicit: null, uri: null },
  likedAt: null,
  videoId,
  confidence: null,
  candidates: [],
});

describe('ImportTrackList', () => {
  const items = [item(0, 'accepted', 'a'), item(1, 'review'), item(2, 'missing'), item(3, 'pending'), item(4, 'pending')];
  const tracks = [track('a')];

  function setup() {
    const onOpenItem = vi.fn();
    const onPlay = vi.fn();
    render(
      <ImportTrackList
        rows={importRows(items, tracks, 'running')}
        onOpenItem={onOpenItem}
        currentId={null}
        isPlaying={false}
        likedIds={new Set()}
        onPlay={onPlay}
        onToggle={vi.fn()}
      />,
    );
    return { onOpenItem, onPlay };
  }

  it('draws rows in source order: the track, a flagged row, a not-found row, the pending ones', () => {
    setup();
    const list = screen.getByTestId('import-track-list');
    const text = list.textContent ?? '';
    const order = ['Track a', 'Source 1', 'Source 2', 'Source 3', 'Source 4'].map((t) => text.indexOf(t));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(screen.getByTestId('needs-review-pill')).toBeInTheDocument();
    expect(screen.getByTestId('not-found-pill')).toBeInTheDocument();
    const pending = screen.getAllByTestId('pending-row');
    expect(pending[0]).toHaveTextContent('Matching…');
    expect(pending[1]).toHaveTextContent('Waiting');
  });

  it('clicking a flagged row opens the review at that song', () => {
    const { onOpenItem } = setup();
    fireEvent.click(screen.getByTestId('import-row-review'));
    expect(onOpenItem).toHaveBeenCalledWith(items[1]);
  });
});
