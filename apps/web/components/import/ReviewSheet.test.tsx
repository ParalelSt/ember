import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ImportCandidate, ImportItem } from '@/lib/import/types';
import type { Track } from '@/types/track';

// base-ui's dialog resolves a second React copy under happy-dom (see
// ChangelogBadge.test.tsx): render its parts as plain elements.
vi.mock('@base-ui/react/dialog', () => {
  const Pass = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    Dialog: {
      Root: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <>{children}</> : null),
      Portal: Pass,
      Backdrop: () => null,
      Popup: ({ children, ...rest }: ComponentProps<'div'>) => (
        <div role="dialog" {...rest}>
          {children}
        </div>
      ),
      Title: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
      Close: ({ children }: PropsWithChildren) => (
        <button type="button" aria-label="Close">
          {children}
        </button>
      ),
    },
  };
});
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: ComponentProps<'input'>) => <input {...props} /> }));

const { ReviewSheet } = await import('./ReviewSheet');

const track = (id: string, title: string): Track => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title,
  artist: 'Tame Impala',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 230,
  artworkUrl: null,
  streamUrl: '',
});

const cand = (id: string, title: string, score: number, reasons: string[], videoType = 'ATV'): ImportCandidate => ({
  track: track(id, title),
  artists: ['Tame Impala'],
  videoType,
  explicit: null,
  score,
  reasons,
});

const loser: ImportItem = {
  id: 'i2',
  position: 2,
  status: 'review',
  source: { position: 2, title: 'Loser', artists: ['Tame Impala'], artist: 'Tame Impala', durationMs: 223_000, explicit: true, uri: null },
  videoId: null,
  confidence: 55,
  candidates: [
    cand('loserLive01', 'Loser - Live at Glastonbury', 55, ['Same title', 'Same artist', 'Live version', 'Official audio']),
    cand('loserStudio', 'Loser', 45, ['Same title', 'Length off by 12 min 56 s', 'Fan upload'], 'UGC'),
    cand('loserThird1', 'Loser (Cover)', 20, ['Cover']),
    cand('loserFourth', 'Loser 4', 10, []),
  ],
};
const earrings: ImportItem = { ...loser, id: 'i4', position: 4, source: { ...loser.source, title: 'Earrings', position: 4 } };

function setup(over: Partial<ComponentProps<typeof ReviewSheet>> = {}) {
  const props: ComponentProps<typeof ReviewSheet> = {
    open: true,
    onClose: vi.fn(),
    mode: 'review',
    playlistName: 'Top Hits',
    source: 'spotify',
    queue: [loser, earrings],
    index: 0,
    previewId: null,
    previewPlaying: false,
    onPreview: vi.fn(),
    onPick: vi.fn(),
    onSkip: vi.fn(),
    onRemove: vi.fn(),
    searchResults: null,
    searching: false,
    onSearch: vi.fn(),
    ...over,
  };
  render(<ReviewSheet {...props} />);
  return props;
}

describe('ReviewSheet', () => {
  it('shows the source track and its first three candidates with plain-word reasons', () => {
    setup();
    const src = screen.getByTestId('review-source');
    expect(within(src).getByText('Loser')).toBeInTheDocument();
    expect(within(src).getByText(/Tame Impala · 3:43 · Explicit/)).toBeInTheDocument();
    expect(within(src).getByText('On Spotify')).toBeInTheDocument();
    expect(screen.getByTestId('review-position')).toHaveTextContent('1 of 2 · Top Hits');
    const rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Best match')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Official audio')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Live version').closest('[data-good]')).toHaveAttribute('data-good', 'false');
    expect(within(rows[1]).getByText('Fan upload')).toBeInTheDocument();
    expect(screen.getByText('Show 1 more')).toBeInTheDocument();
  });

  it('key 2 picks the second candidate, key 1 the first', () => {
    const p = setup();
    fireEvent.keyDown(window, { key: '2' });
    expect(p.onPick).toHaveBeenLastCalledWith(loser, loser.candidates[1].track);
    fireEvent.keyDown(window, { key: '1' });
    expect(p.onPick).toHaveBeenLastCalledWith(loser, loser.candidates[0].track);
    fireEvent.keyDown(window, { key: '4' });
    expect(p.onPick).toHaveBeenCalledTimes(2);
  });

  it('S skips; keys are left alone while typing a search', () => {
    const p = setup();
    fireEvent.keyDown(window, { key: 's' });
    expect(p.onSkip).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Search YouTube/ }));
    const box = screen.getByLabelText('Search YouTube Music');
    fireEvent.keyDown(box, { key: '2' });
    fireEvent.keyDown(box, { key: 's' });
    expect(p.onPick).not.toHaveBeenCalled();
    expect(p.onSkip).toHaveBeenCalledTimes(1);
  });

  it('no picks while a pick is being saved', () => {
    const p = setup({ busy: true });
    fireEvent.keyDown(window, { key: '1' });
    expect(p.onPick).not.toHaveBeenCalled();
  });

  it('buttons: use best match, remove song, preview', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Use best match' }));
    expect(p.onPick).toHaveBeenCalledWith(loser, loser.candidates[0].track);
    fireEvent.click(screen.getByRole('button', { name: /Remove song/ }));
    expect(p.onRemove).toHaveBeenCalledWith(loser);
    fireEvent.click(screen.getByRole('button', { name: 'Preview "Loser"' }));
    expect(p.onPreview).toHaveBeenCalledWith(loser.candidates[1].track);
  });

  it('a candidate being previewed offers pause', () => {
    setup({ previewId: 'youtube:loserStudio', previewPlaying: true });
    expect(screen.getByRole('button', { name: 'Pause "Loser"' })).toBeInTheDocument();
  });

  it('"none of these": search, then use a result', () => {
    const found = track('foundfound1', 'Loser (Studio)');
    const p = setup({ searchResults: [found] });
    fireEvent.click(screen.getByRole('button', { name: /Search YouTube/ }));
    const box = screen.getByLabelText('Search YouTube Music');
    expect(box).toHaveValue('Loser Tame Impala');
    fireEvent.submit(box.closest('form')!);
    expect(p.onSearch).toHaveBeenCalledWith('Loser Tame Impala');
    fireEvent.click(screen.getByTestId('review-search-result'));
    expect(p.onPick).toHaveBeenCalledWith(loser, found);
  });

  it('past the last song it says all reviewed', () => {
    const p = setup({ index: 2 });
    expect(screen.getByTestId('review-done')).toHaveTextContent('All reviewed');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the playlist' }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('a not-found song has no best match to take', () => {
    setup({ queue: [{ ...loser, status: 'missing' }] });
    expect(screen.getByText('Nothing on YouTube Music was close enough')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use best match' })).toBeDisabled();
  });

  it('re-match: marks the song in the playlist and has no skip', () => {
    const p = setup({ mode: 'rematch', queue: [{ ...loser, status: 'accepted', videoId: 'loserLive01' }] });
    expect(screen.getByRole('heading', { name: 'Re-match' })).toBeInTheDocument();
    expect(within(screen.getAllByTestId('candidate-row')[0]).getByText('In the playlist')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
    fireEvent.keyDown(window, { key: 's' });
    expect(p.onSkip).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: '2' });
    expect(p.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'i2' }), loser.candidates[1].track);
  });
});
