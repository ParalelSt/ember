import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Track } from '@/types/track';
import { PlayerBar } from './PlayerBar';
import { NowPlaying } from './NowPlaying';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';

// The tabs button opens the tab page for the playing song: the player bar
// on desktop, the full-screen Now playing view on phones. Everything else
// in those two components is stubbed.

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: '/' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => nav.pathname }));

const TRACK: Track = {
  id: 'youtube:dQw4w9WgXcQ',
  source: 'youtube',
  sourceId: 'dQw4w9WgXcQ',
  title: 'Copper Sky',
  artist: 'Coastline',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 180,
  artworkUrl: null,
  streamUrl: '/x',
};
const player = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({
    current: player.current,
    isPlaying: true,
    position: 0,
    duration: 180,
    volume: 1,
    toggle: () => {},
    next: () => {},
    prev: () => {},
    seek: () => {},
    setVolume: () => {},
  }),
}));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLikeToggle', () => ({ useLikeToggle: () => ({ liked: false, toggle: () => {} }) }));
vi.mock('@/lib/offlineNative', () => ({ useTrackArtSrc: () => null }));
vi.mock('@/lib/useBackDismiss', () => ({ useBackDismiss: () => {} }));
const Stub = vi.hoisted(() => () => null);
vi.mock('@/components/player/QueueSheet', () => ({ QueueSheet: Stub }));
vi.mock('@/components/player/EqualizerSheet', () => ({ EqualizerSheet: Stub }));
vi.mock('@/components/player/SeekBar', () => ({ SeekBar: Stub }));
vi.mock('@/components/player/VolumeControl', () => ({ VolumeControl: Stub }));
vi.mock('@/components/player/LyricsBody', () => ({ LyricsBody: Stub }));
vi.mock('@/components/player/NowPlayingSummary', () => ({ NowPlayingSummary: Stub }));
vi.mock('@/components/player/TransportControls', () => ({ TransportControls: Stub }));
vi.mock('@/components/primitives/Artwork', () => ({ Artwork: Stub }));

const initialSettings = useSettingsStore.getState();

beforeEach(() => {
  nav.push.mockReset();
  nav.pathname = '/';
  player.current = TRACK;
  useSettingsStore.setState(initialSettings, true);
});

describe('tabs entry points', () => {
  it('the player bar’s Guitar tabs button opens /tabs/<current track id>', () => {
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Guitar tabs' }));
    expect(nav.push).toHaveBeenCalledWith('/tabs/youtube%3AdQw4w9WgXcQ');
  });

  it('the button shows as on while the tab page for this song is open', () => {
    nav.pathname = '/tabs/youtube%3AdQw4w9WgXcQ';
    render(<PlayerBar />);
    expect(screen.getByRole('button', { name: 'Guitar tabs' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('no dialog any more: nothing opens in place', () => {
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Guitar tabs' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('on phones, Now playing opens the same page and closes itself', async () => {
    usePlayerStore.getState().setNowPlayingOpen(true);
    render(<NowPlaying />);
    fireEvent.click(screen.getByRole('button', { name: 'Guitar tabs' }));
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
    // After the view's own history entry is popped, so the back cannot undo it.
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/tabs/youtube%3AdQw4w9WgXcQ'));
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it('the player bar hides the Guitar tabs button when the plugin is off', () => {
    useSettingsStore.getState().setTabsEnabled(false);
    render(<PlayerBar />);
    expect(screen.queryByRole('button', { name: 'Guitar tabs' })).toBeNull();
  });

  it('Now playing hides the Guitar tabs button when the plugin is off', () => {
    useSettingsStore.getState().setTabsEnabled(false);
    usePlayerStore.getState().setNowPlayingOpen(true);
    render(<NowPlaying />);
    expect(screen.queryByRole('button', { name: 'Guitar tabs' })).toBeNull();
  });
});
