import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Track } from '@/types/track';
import { NowPlaying } from './NowPlaying';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCastStore } from '@/stores/useCastStore';
import { useOutputStore } from '@/stores/useOutputStore';

// The phone bar keeps only play/pause, so the full-screen view is where a
// phone reaches previous, next, the queue and the other tools. The layout:
// a close chevron, a "Playing from" title and a More menu on top; one row
// of labelled tools (Devices, Tabs, EQ, Queue) under the controls.

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => '/' }));

const TRACK: Track = {
  id: 't1',
  source: 'youtube',
  sourceId: 'v1',
  title: 'Copper Sky',
  artist: 'Coastline',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 180,
  artworkUrl: null,
  streamUrl: '/x',
};
const player = vi.hoisted(() => ({ toggle: vi.fn(), next: vi.fn(), prev: vi.fn(), current: null as unknown }));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({
    current: player.current,
    isPlaying: true,
    position: 0,
    duration: 180,
    toggle: player.toggle,
    next: player.next,
    prev: player.prev,
    seek: () => {},
  }),
}));
const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/hooks/useLikeToggle', () => ({ useLikeToggle: () => ({ liked: false, toggle: () => {} }) }));
vi.mock('@/lib/offlineNative', () => ({ useTrackArtSrc: () => null }));
vi.mock('@/lib/useBackDismiss', () => ({ useBackDismiss: () => {} }));
const share = vi.hoisted(() => ({ shareTrack: vi.fn(async () => {}) }));
vi.mock('@/components/track/ShareButton', () => ({
  ShareButton: () => <button type="button">Share (like row)</button>,
  canShare: (t: Track) => t.source === 'youtube',
  shareTrack: share.shareTrack,
}));
// The like row's + menu: here it only has to show whether it was opened.
vi.mock('@/components/track/menus/AddToPlaylistMenu', () => ({
  AddToPlaylistMenu: ({ open }: { open?: boolean }) => (
    <>
      <button type="button" aria-label="Add to playlist (like row)" />
      {open && <div data-testid="add-to-playlist-menu" />}
    </>
  ),
}));
vi.mock('@/lib/outputs/controller', () => ({
  chooseOutput: vi.fn(async () => {}),
  openSystemPicker: vi.fn(async () => {}),
  chooseCastDevice: vi.fn(async () => {}),
  openCastPicker: vi.fn(async () => {}),
  stopCasting: vi.fn(async () => {}),
  refreshOutputs: vi.fn(async () => {}),
}));
// The sheet itself is QueueSheet's business: here it only has to be told to open.
vi.mock('@/components/player/QueueSheet', () => ({
  QueueSheet: ({ open }: { open: boolean }) => (open ? <div data-testid="queue-sheet" /> : null),
}));
// base-ui's menu and dialog bring the root's second React into a test render
// (see QueueSheet.test.tsx): plain boxes that show while open.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, ...rest }: { children: ReactNode }) => <div {...rest}>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/dropdown-menu', () => {
  let menu: { open: boolean; onOpenChange: (o: boolean) => void } = { open: false, onOpenChange: () => {} };
  return {
    DropdownMenu: ({ children, open, onOpenChange }: { children: ReactNode; open: boolean; onOpenChange: (o: boolean) => void }) => {
      menu = { open, onOpenChange };
      return <div>{children}</div>;
    },
    DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => (
      <button {...rest} onClick={() => menu.onOpenChange(!menu.open)}>{children}</button>
    ),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => (menu.open ? <div role="menu">{children}</div> : null),
    DropdownMenuItem: ({ children, onClick }: ComponentProps<'div'>) => (
      <div role="menuitem" onClick={onClick}>{children}</div>
    ),
  };
});
const Stub = vi.hoisted(() => () => null);
vi.mock('@/components/player/SeekBar', () => ({ SeekBar: Stub }));
vi.mock('@/components/player/LyricsBody', () => ({ LyricsBody: Stub }));
vi.mock('@/components/player/NowPlayingSummary', () => ({ NowPlayingSummary: Stub }));

const initialSettings = useSettingsStore.getState();
const NO_OUTPUTS = { platform: null, devices: [], currentId: null, currentName: null, currentKind: null, systemPicker: null, castDevices: null };
const PHONE_WITH_BUDS = {
  platform: 'android' as const,
  devices: [
    { id: '2', name: 'This phone', kind: 'phone' as const },
    { id: '9', name: 'Pixel Buds', kind: 'bluetooth' as const },
  ],
  currentId: '2',
  currentName: 'This phone',
  currentKind: 'phone' as const,
  systemPicker: 'android-switcher' as const,
  castDevices: null,
};

const view = () => screen.getByTestId('now-playing');
const row = () => screen.getByTestId('tool-row');
const rowLabels = () => Array.from(row().querySelectorAll('button')).map((b) => b.textContent);

beforeEach(() => {
  player.toggle.mockReset();
  player.next.mockReset();
  player.prev.mockReset();
  player.current = TRACK;
  auth.user = null;
  nav.push.mockReset();
  share.shareTrack.mockClear();
  useSettingsStore.setState(initialSettings, true);
  useOutputStore.setState(PHONE_WITH_BUDS);
  useCastStore.setState({ path: null, availability: 'none', connection: 'idle', deviceName: null });
  usePlayerStore.setState({ context: null });
  usePlayerStore.getState().setNowPlayingOpen(true);
});
afterEach(() => {
  useOutputStore.setState(NO_OUTPUTS);
  useCastStore.setState({ path: null, availability: 'none', connection: 'idle', deviceName: null });
});

describe('NowPlaying', () => {
  it('has previous, play/pause and next, and they work', () => {
    render(<NowPlaying />);
    fireEvent.click(within(view()).getByRole('button', { name: 'Previous' }));
    fireEvent.click(within(view()).getByRole('button', { name: 'Pause' }));
    fireEvent.click(within(view()).getByRole('button', { name: 'Next' }));
    expect([player.prev, player.toggle, player.next].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });
});

describe('NowPlaying: the top row', () => {
  it('is the close chevron, the "Playing from" title and More, and no tool icons', () => {
    player.current = { ...TRACK, artistId: 'UC1' };
    usePlayerStore.setState({ context: { type: 'playlist', playlistId: 'p1', playlistName: 'Road trip' } });
    render(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent('Playing from playlistRoad trip');
    expect(within(view()).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(view()).getByRole('button', { name: 'More' })).toBeInTheDocument();
    // Every tool lives in the row under the controls, once.
    for (const name of ['Queue', 'Equalizer', 'Guitar tabs', 'Devices']) {
      const buttons = within(view()).getAllByRole('button', { name });
      expect(buttons).toHaveLength(1);
      expect(row()).toContainElement(buttons[0]);
    }
  });

  it('names the album, artist, liked songs or search it plays from, and says "Now playing" for a lone song', () => {
    const { rerender } = render(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent(/^Now playing$/);
    act(() => usePlayerStore.setState({ context: { type: 'album', albumId: 'a', albumTitle: 'Blue' } }));
    rerender(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent('Playing from albumBlue');
    act(() => usePlayerStore.setState({ context: { type: 'artist', artistName: 'Baccara' } }));
    rerender(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent('Playing from artistBaccara');
    act(() => usePlayerStore.setState({ context: { type: 'liked' } }));
    rerender(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent('Playing fromLiked songs');
    act(() => usePlayerStore.setState({ context: { type: 'search', query: 'boogie' } }));
    rerender(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent('Playing from search"boogie"');
    act(() => usePlayerStore.setState({ context: { type: 'single' } }));
    rerender(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent(/^Now playing$/);
  });

  it('More goes to the artist and the album, closing the player first', async () => {
    player.current = { ...TRACK, artistId: 'UC1', albumId: 'MPRE b' };
    render(<NowPlaying />);
    fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Go to artist', 'Go to album', 'Share']);
    fireEvent.click(within(menu).getByText('Go to artist'));
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/artist/UC1'));

    act(() => usePlayerStore.getState().setNowPlayingOpen(true));
    fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Go to album'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/album/MPRE%20b'));
  });

  it('signed out, More shares the song (there is no like row to carry Share)', () => {
    render(<NowPlaying />);
    expect(within(view()).queryByRole('button', { name: 'Share (like row)' })).toBeNull();
    fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Share'));
    expect(share.shareTrack).toHaveBeenCalledWith(TRACK);
  });

  it('signed in, More has Add to playlist, which opens the like row’s playlist menu; Share stays in the like row', () => {
    auth.user = { id: 'u1' };
    render(<NowPlaying />);
    expect(within(view()).getByRole('button', { name: 'Share (like row)' })).toBeInTheDocument();
    fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['Add to playlist']);
    expect(screen.queryByTestId('add-to-playlist-menu')).toBeNull();
    fireEvent.click(within(menu).getByText('Add to playlist'));
    expect(screen.getByTestId('add-to-playlist-menu')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes More and the playlist menu when the song changes, so they never act on the next song', () => {
    auth.user = { id: 'u1' };
    player.current = { ...TRACK, artistId: 'UC1' };
    const { rerender } = render(<NowPlaying />);
    fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // Song A ends and B starts while the menu is still up.
    player.current = { ...TRACK, id: 't2', sourceId: 'v2', title: 'Other', artistId: 'UC2' };
    rerender(<NowPlaying />);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Add to playlist'));
    expect(screen.getByTestId('add-to-playlist-menu')).toBeInTheDocument();
    player.current = { ...TRACK, id: 't3', sourceId: 'v3', title: 'Third' };
    rerender(<NowPlaying />);
    expect(screen.queryByTestId('add-to-playlist-menu')).toBeNull();
  });

  it('closes More and the playlist menu when the player closes without them (Back, Escape)', () => {
    auth.user = { id: 'u1' };
    render(<NowPlaying />);
    fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    act(() => usePlayerStore.getState().setNowPlayingOpen(false));
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => usePlayerStore.getState().setNowPlayingOpen(true));
    fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Add to playlist'));
    expect(screen.getByTestId('add-to-playlist-menu')).toBeInTheDocument();
    act(() => usePlayerStore.getState().setNowPlayingOpen(false));
    expect(screen.queryByTestId('add-to-playlist-menu')).toBeNull();
  });

  it('has no More button when it would be empty', () => {
    player.current = { ...TRACK, source: 'jamendo' };
    render(<NowPlaying />);
    expect(within(view()).queryByRole('button', { name: 'More' })).toBeNull();
    expect(within(view()).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('NowPlaying: the tool row', () => {
  it('has Devices, Tabs, EQ and Queue, each an icon with a label', () => {
    render(<NowPlaying />);
    expect(rowLabels()).toEqual(['Devices', 'Tabs', 'EQ', 'Queue']);
    expect(row().querySelectorAll('svg')).toHaveLength(4);
  });

  it('hides Tabs when guitar tabs are off in settings', () => {
    useSettingsStore.getState().setTabsEnabled(false);
    render(<NowPlaying />);
    expect(rowLabels()).toEqual(['Devices', 'EQ', 'Queue']);
  });

  it('hides EQ while casting to a Cast device, which plays without it, and keeps it over AirPlay', () => {
    useCastStore.setState({ path: 'android', availability: 'available', connection: 'connected', deviceName: 'Living Room TV' });
    const { rerender } = render(<NowPlaying />);
    expect(rowLabels()).toEqual(['Living Room TV', 'Tabs', 'Queue']);
    act(() => useCastStore.setState({ path: 'airplay', connection: 'connected', deviceName: null }));
    rerender(<NowPlaying />);
    expect(rowLabels()).toEqual(['AirPlay', 'Tabs', 'EQ', 'Queue']);
  });

  it('hides Devices when there is nothing to choose', () => {
    useOutputStore.setState(NO_OUTPUTS);
    render(<NowPlaying />);
    expect(rowLabels()).toEqual(['Tabs', 'EQ', 'Queue']);
  });

  it('Queue opens the queue sheet over the player', () => {
    render(<NowPlaying />);
    expect(screen.queryByTestId('queue-sheet')).toBeNull();
    fireEvent.click(within(row()).getByRole('button', { name: 'Queue' }));
    expect(screen.getByTestId('queue-sheet')).toBeInTheDocument();
    // The view stays open underneath: the sheet is on top of it.
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(true);
  });

  it('EQ opens the equalizer in a sheet, and it works there; the button is lit while it is on', async () => {
    useSettingsStore.setState({ equalizer: { enabled: false, bands: [0, 0, 0, 0, 0] } });
    const { rerender } = render(<NowPlaying />);
    expect(screen.queryByTestId('equalizer')).toBeNull();
    const eq = within(row()).getByRole('button', { name: 'Equalizer' });
    expect(eq.className).not.toContain('text-ember');
    fireEvent.click(eq);
    const panel = await screen.findByTestId('equalizer');
    fireEvent.click(within(panel).getByRole('button', { name: 'Bass boost' }));
    expect(useSettingsStore.getState().equalizer).toEqual({ enabled: true, bands: [7, 4, 0, 0, 0] });
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(true);
    rerender(<NowPlaying />);
    expect(within(row()).getByRole('button', { name: 'Equalizer' }).className).toContain('text-ember');
  });

  it('Tabs closes the player and opens the tab page for the song', async () => {
    render(<NowPlaying />);
    fireEvent.click(within(row()).getByRole('button', { name: 'Guitar tabs' }));
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/tabs/t1'));
  });

  it('Devices opens the devices picker', () => {
    render(<NowPlaying />);
    expect(screen.queryByTestId('devices-list')).toBeNull();
    fireEvent.click(within(row()).getByRole('button', { name: 'Devices' }));
    const list = screen.getByTestId('devices-list');
    expect(within(list).getByText('Pixel Buds')).toBeInTheDocument();
    expect(within(list).getByText('More devices')).toBeInTheDocument();
  });
});

describe('NowPlaying: the Devices label', () => {
  it('names headphones the phone plays through, and says Devices on the phone’s own speaker; no separate "Playing on" line', () => {
    useOutputStore.setState({ currentId: '9', currentName: 'Pixel Buds', currentKind: 'bluetooth' });
    const { rerender } = render(<NowPlaying />);
    const devices = within(row()).getByTestId('devices-button');
    expect(devices).toHaveTextContent('Pixel Buds');
    expect(devices).toHaveAccessibleName('Devices: playing on Pixel Buds');
    expect(devices.className).toContain('text-ember');
    expect(within(view()).queryByTestId('playing-on')).toBeNull();
    expect(within(view()).queryByText(/Playing on/)).toBeNull();
    act(() => useOutputStore.setState({ currentId: '2', currentName: 'This phone', currentKind: 'phone' }));
    rerender(<NowPlaying />);
    expect(within(row()).getByTestId('devices-button')).toHaveTextContent(/^Devices$/);
    expect(within(row()).getByTestId('devices-button').className).not.toContain('text-ember');
  });

  it('names the TV while casting, and shows up once a cast device is around', () => {
    useOutputStore.setState(NO_OUTPUTS);
    useCastStore.setState({ path: 'google', availability: 'none', connection: 'idle', deviceName: null });
    const { rerender } = render(<NowPlaying />);
    expect(within(view()).queryByTestId('devices-button')).toBeNull();
    act(() => useCastStore.setState({ availability: 'available' }));
    rerender(<NowPlaying />);
    expect(within(row()).getByTestId('devices-button')).toHaveTextContent(/^Devices$/);
    act(() => useCastStore.setState({ connection: 'connected', deviceName: 'Living Room TV' }));
    rerender(<NowPlaying />);
    expect(within(row()).getByRole('button', { name: 'Devices: playing on Living Room TV' })).toHaveTextContent('Living Room TV');
    expect(within(view()).queryByText(/Playing on/)).toBeNull();
  });
});
