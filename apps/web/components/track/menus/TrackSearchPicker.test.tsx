import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Track } from '@/types/track';

const recs: Track[] = Array.from({ length: 20 }, (_, i) => ({
  id: `r${i}`,
  source: 'youtube',
  sourceId: `v${i}`,
  title: `Rec ${i + 1}`,
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 1,
  artworkUrl: null,
  streamUrl: '',
}));
vi.mock('@/lib/api', () => ({
  api: { getRecommended: vi.fn(async () => ({ tracks: recs })), search: vi.fn(async () => ({ tracks: [] })) },
}));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ current: null, isPlaying: false, playTrack: vi.fn(), toggle: vi.fn() }),
}));

const { TrackSearchPicker } = await import('./TrackSearchPicker');

// Bughunt V7: in the New playlist dialog (capped at 90% of the window) the
// recommended list ran under the footer and out of the dialog, because the
// box around it could not shrink. The list and its wrapper must be a
// shrinkable column (the overflow itself is measured in a real browser by
// tests/layout-v7-new-playlist-dialog.test.mjs).
describe('TrackSearchPicker', () => {
  it('lets the recommended list shrink and scroll inside a height-capped parent', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TrackSearchPicker onAdd={vi.fn()} />
      </QueryClientProvider>,
    );
    const row = await screen.findByText('Rec 20');
    const list = row.closest('.overflow-y-auto') as HTMLElement;
    expect(list).not.toBeNull();
    expect(list.parentElement).toHaveClass('flex', 'min-h-0', 'flex-col');
    expect(list.parentElement!.parentElement).toHaveClass('min-h-0');
  });
});
