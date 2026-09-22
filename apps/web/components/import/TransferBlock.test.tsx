import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ImportItem, ImportJob } from '@/lib/import/types';

// What the Liked page shows above the likes while a transfer runs: the
// banner, and the songs that are not likes yet.

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
const { TransferBlock } = await import('./TransferBlock');

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: 'j1',
  userId: 'u1',
  kind: 'liked',
  playlistId: null,
  name: 'Liked songs from Spotify',
  source: 'csv',
  sourceUrl: '',
  coverUrl: null,
  status: 'running',
  total: 1200,
  cursor: 240,
  accepted: 198,
  review: 18,
  missing: 3,
  existing: 21,
  error: null,
  retryAt: null,
  dismissed: false,
  ...over,
});

const item = (position: number, status: ImportItem['status'], videoId: string | null = null): ImportItem => ({
  id: `i${position}`,
  position,
  status,
  source: { position, title: `Song ${position}`, artists: ['A'], artist: 'A', durationMs: 180_000, explicit: null, uri: null },
  likedAt: null,
  videoId,
  confidence: null,
  candidates: [],
});

const ACTIONS = {
  currentId: null,
  isPlaying: false,
  likedIds: new Set<string>(),
  onPlay: vi.fn(),
  onToggle: vi.fn(),
  onLike: vi.fn(),
};

function setup(j = job(), items = [item(0, 'accepted', 'a'), item(1, 'review'), item(2, 'missing'), item(3, 'pending')]) {
  const cb = { onStop: vi.fn(), onRetry: vi.fn(), onReview: vi.fn(), onDismiss: vi.fn(), onOpenItem: vi.fn() };
  render(<TransferBlock job={j} items={items} {...cb} {...ACTIONS} />);
  return cb;
}

describe('TransferBlock', () => {
  it('while it runs: the progress banner, in transfer words', () => {
    setup();
    const banner = screen.getByTestId('import-progress-banner');
    expect(banner).toHaveTextContent('Transferring from a file, 240 of 1200');
  });

  it('lists only what is not a like yet: the accepted song is already in the list below', () => {
    setup();
    const block = screen.getByTestId('transferring-block');
    expect(block).toHaveTextContent('Transferring');
    expect(block).toHaveTextContent('Song 1');
    expect(block).toHaveTextContent('Song 2');
    expect(block).toHaveTextContent('Song 3');
    expect(block).not.toHaveTextContent('Song 0');
  });

  it('opening one of those rows asks for the review sheet', () => {
    const cb = setup();
    fireEvent.click(screen.getByText('Song 1'));
    expect(cb.onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }));
  });

  it('when it is finished: the summary counts what was already liked, and the block renames itself', () => {
    setup(job({ status: 'done', cursor: 1200, accepted: 1042, review: 61, missing: 18 }));
    expect(screen.getByTestId('import-summary')).toHaveTextContent('Transfer finished');
    expect(screen.getByTestId('import-count-added')).toHaveTextContent('1042 added');
    expect(screen.getByTestId('import-count-already-liked')).toHaveTextContent('21 already liked');
    expect(screen.getByTestId('transferring-block')).toHaveTextContent('Still to sort out');
  });

  it('a playlist import never claims songs were already liked', () => {
    setup(job({ kind: 'playlist', playlistId: 'p1', status: 'done', existing: 0 }));
    expect(screen.getByTestId('import-summary')).toHaveTextContent('Import finished');
    expect(screen.queryByTestId('import-count-already-liked')).toBeNull();
  });

  it('nothing left over: the banner alone', () => {
    setup(job({ status: 'done' }), [item(0, 'accepted', 'a')]);
    expect(screen.queryByTestId('transferring-block')).toBeNull();
    expect(screen.getByTestId('import-summary')).toBeInTheDocument();
  });

  it('Stop, Retry and Dismiss reach the page', () => {
    const cb = setup(job({ status: 'failed', error: 'YouTube Music stopped answering.' }));
    expect(screen.getByTestId('import-error-banner')).toHaveTextContent('Transfer failed at 240 of 1200');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(cb.onRetry).toHaveBeenCalled();
  });
});
