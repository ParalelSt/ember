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
// a close chevron, the "Playing from" title and one More button on top;
// More opens one sheet that holds every other action; under the controls,
// nothing but the seek bar and the transport.

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
const lyrics = vi.hoisted(() => ({ data: null as unknown }));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: lyrics.data }) }));
const share = vi.hoisted(() => ({ shareTrack: vi.fn(async () => {}) }));
vi.mock('@/components/track/ShareButton', () => ({
  ShareButton: () => <button type="button">Share (like row)</button>,
  canShare: (t: Track) => t.source === 'youtube',
  shareTrack: share.shareTrack,
}));
// The playlist menu: here it only has to open, from an anchor nobody sees.
vi.mock('@/components/track/menus/AddToPlaylistMenu', () => ({
  AddToPlaylistMenu: ({ open, hiddenTrigger }: { open?: boolean; hiddenTrigger?: boolean }) => (
    <>
      <span data-testid="add-anchor" data-hidden={hiddenTrigger} />
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
// The lyrics card: here it only has to show whether its report form is open.
vi.mock('@/components/player/LyricsBody', () => ({
  LyricsBody: ({ reportOpen }: { reportOpen?: boolean }) => (reportOpen ? <div data-testid="lyrics-report" /> : null),
}));
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
const openMore = () => fireEvent.click(within(view()).getByRole('button', { name: 'More' }));
const sheet = () => screen.getByTestId('now-playing-more-sheet');
const rows = () => Array.from(sheet().querySelectorAll<HTMLElement>('[data-testid^="more-"]')).map((b) => b.dataset.testid!.slice(5));
const row = (key: string) => within(sheet()).getByTestId(`more-${key}`);
const LYRICS = { lyrics: 'la la', synced: null, source: 'lrclib' };

beforeEach(() => {
  player.toggle.mockReset();
  player.next.mockReset();
  player.prev.mockReset();
  player.current = TRACK;
  auth.user = null;
  lyrics.data = null;
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
  it('is the close chevron, the "Playing from" title and one More button, nothing else', () => {
    auth.user = { id: 'u1' };
    player.current = { ...TRACK, artistId: 'UC1' };
    usePlayerStore.setState({ context: { type: 'playlist', playlistId: 'p1', playlistName: 'Road trip' } });
    render(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent('Playing from playlistRoad trip');
    expect(within(view()).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(view()).getAllByRole('button', { name: 'More' })).toHaveLength(1);
    // On the player itself: Like, Devices and Lyrics, and nothing else.
    for (const name of ['Like', 'Devices', 'Lyrics']) {
      expect(within(view()).getAllByRole('button', { name })).toHaveLength(1);
    }
    for (const name of ['Equalizer', 'Guitar tabs', 'Up next', 'Queue']) {
      expect(within(view()).queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByTestId('tool-row')).toBeNull();
    expect(screen.getByTestId('add-anchor')).toHaveAttribute('data-hidden', 'true');
  });

  // Bughunt V6: Close and More float over the scroller with no background,
  // so scrolled lyrics slid under them and read through the buttons. Once
  // scrolled, the band under the buttons fades the content out instead; at
  // the top nothing changes (the "Playing from" title sits in that band).
  it('fades scrolled content out under the floating buttons, and only once scrolled', () => {
    render(<NowPlaying />);
    const scroller = screen.getByTestId('now-playing-scroller');
    expect(scroller.style.maskImage).toBe('');
    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);
    expect(scroller.style.maskImage).toContain('transparent calc(var(--safe-top) + 3.5rem)');
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(scroller.style.maskImage).toBe('');
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
});

describe('NowPlaying: the More sheet', () => {
  it('signed in, holds one plain list of actions, each once, under the song', () => {
    auth.user = { id: 'u1' };
    lyrics.data = LYRICS;
    player.current = { ...TRACK, artistId: 'UC1', albumId: 'MPRE b' };
    render(<NowPlaying />);
    expect(screen.queryByTestId('now-playing-more-sheet')).toBeNull();
    openMore();
    expect(within(sheet()).getByText('Copper Sky')).toBeInTheDocument();
    expect(within(sheet()).getByText('Coastline')).toBeInTheDocument();
    expect(rows()).toEqual(['add', 'queue', 'tabs', 'eq', 'share', 'artist', 'album', 'report']);
    expect(sheet().querySelectorAll('[role="group"]')).toHaveLength(0);
    expect(row('share')).toHaveTextContent('Copy link');
    // Like, Lyrics and Devices are on the player, not in the sheet.
    expect(within(sheet()).queryByText(/^(Like|Liked|Lyrics|Devices)$/)).toBeNull();
  });

  it('signed out, keeps what needs no account', () => {
    render(<NowPlaying />);
    openMore();
    expect(rows()).toEqual(['queue', 'tabs', 'eq', 'share']);
    expect(within(view()).queryByRole('button', { name: 'Like' })).toBeNull();
  });

  it('Like sits beside the title and toggles', () => {
    auth.user = { id: 'u1' };
    render(<NowPlaying />);
    const like = within(view()).getByRole('button', { name: 'Like' });
    expect(like).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(like);
    expect(like).toBeInTheDocument();
  });

  it('Add to playlist closes the sheet and opens the playlist menu', () => {
    auth.user = { id: 'u1' };
    render(<NowPlaying />);
    openMore();
    fireEvent.click(row('add'));
    expect(screen.queryByTestId('now-playing-more-sheet')).toBeNull();
    expect(screen.getByTestId('add-to-playlist-menu')).toBeInTheDocument();
  });

  it('Copy link shares the song', () => {
    render(<NowPlaying />);
    openMore();
    fireEvent.click(row('share'));
    expect(share.shareTrack).toHaveBeenCalledWith(TRACK);
  });

  it('Up next opens the queue sheet over the player', () => {
    render(<NowPlaying />);
    openMore();
    fireEvent.click(row('queue'));
    expect(screen.getByTestId('queue-sheet')).toBeInTheDocument();
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(true);
  });

  it('the Lyrics button scrolls down to the lyrics card', () => {
    const scroll = vi.fn();
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scroll);
    render(<NowPlaying />);
    fireEvent.click(within(view()).getByRole('button', { name: 'Lyrics' }));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    spy.mockRestore();
  });

  it('Guitar tabs closes the player and opens the tab page; off in settings, it is gone', async () => {
    const { unmount } = render(<NowPlaying />);
    openMore();
    fireEvent.click(row('tabs'));
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/tabs/t1'));
    unmount();
    act(() => useSettingsStore.setState({ tabsEnabled: false }));
    act(() => usePlayerStore.getState().setNowPlayingOpen(true));
    render(<NowPlaying />);
    openMore();
    expect(rows()).not.toContain('tabs');
  });

  it('Equalizer opens the equalizer sheet, which works; the row says On and is lit while it is on', async () => {
    useSettingsStore.setState({ equalizer: { enabled: false, bands: [0, 0, 0, 0, 0] } });
    render(<NowPlaying />);
    openMore();
    expect(row('eq')).toHaveTextContent('EqualizerOff');
    fireEvent.click(row('eq'));
    const panel = await screen.findByTestId('equalizer');
    fireEvent.click(within(panel).getByRole('button', { name: 'Bass boost' }));
    expect(useSettingsStore.getState().equalizer).toEqual({ enabled: true, bands: [7, 4, 0, 0, 0] });
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(true);
    openMore();
    expect(row('eq')).toHaveTextContent('EqualizerOn');
    expect(row('eq').querySelector('svg')!.getAttribute('class')).toContain('text-ember');
  });

  it('hides Equalizer while casting to a Cast device, and keeps it over AirPlay', () => {
    useCastStore.setState({ path: 'android', availability: 'available', connection: 'connected', deviceName: 'Living Room TV' });
    const { rerender } = render(<NowPlaying />);
    openMore();
    expect(rows()).not.toContain('eq');
    act(() => useCastStore.setState({ path: 'airplay', connection: 'connected', deviceName: null }));
    rerender(<NowPlaying />);
    expect(rows()).toContain('eq');
  });

  const devicesBtn = () => within(view()).getByRole('button', { name: 'Devices' });

  it('Devices opens the devices picker, and names where it plays when not the phone', () => {
    useOutputStore.setState({ currentId: '9', currentName: 'Pixel Buds', currentKind: 'bluetooth' });
    render(<NowPlaying />);
    expect(devicesBtn()).toHaveTextContent('Pixel Buds');
    fireEvent.click(devicesBtn());
    const list = screen.getByTestId('devices-list');
    expect(within(list).getByText('Pixel Buds')).toBeInTheDocument();
    expect(within(list).getByText('More devices')).toBeInTheDocument();
  });

  it('Devices says nothing more on the phone’s own speaker, and is gone with nothing to choose', () => {
    const { rerender } = render(<NowPlaying />);
    expect(devicesBtn()).toHaveTextContent(/^$/);
    act(() => useOutputStore.setState(NO_OUTPUTS));
    rerender(<NowPlaying />);
    expect(within(view()).queryByRole('button', { name: 'Devices' })).toBeNull();
  });

  it('names the TV while casting', () => {
    useOutputStore.setState(NO_OUTPUTS);
    useCastStore.setState({ path: 'google', availability: 'available', connection: 'connected', deviceName: 'Living Room TV' });
    render(<NowPlaying />);
    expect(devicesBtn()).toHaveTextContent('Living Room TV');
  });

  it('goes to the artist and the album, closing the player first', async () => {
    player.current = { ...TRACK, artistId: 'UC1', albumId: 'MPRE b' };
    render(<NowPlaying />);
    openMore();
    fireEvent.click(row('artist'));
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/artist/UC1'));
    act(() => usePlayerStore.getState().setNowPlayingOpen(true));
    openMore();
    fireEvent.click(row('album'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/album/MPRE%20b'));
  });

  it('Report wrong lyrics shows only with lyrics, and opens the lyrics card’s report form', () => {
    const { rerender } = render(<NowPlaying />);
    openMore();
    expect(rows()).not.toContain('report');
    lyrics.data = LYRICS;
    rerender(<NowPlaying />);
    fireEvent.click(row('report'));
    expect(screen.getByTestId('lyrics-report')).toBeInTheDocument();
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(true);
  });

  it('closes the sheet and the playlist menu when the song changes, so they never act on the next song', () => {
    auth.user = { id: 'u1' };
    const { rerender } = render(<NowPlaying />);
    openMore();
    player.current = { ...TRACK, id: 't2', sourceId: 'v2', title: 'Other' };
    rerender(<NowPlaying />);
    expect(screen.queryByTestId('now-playing-more-sheet')).toBeNull();
    openMore();
    fireEvent.click(row('add'));
    expect(screen.getByTestId('add-to-playlist-menu')).toBeInTheDocument();
    player.current = { ...TRACK, id: 't3', sourceId: 'v3', title: 'Third' };
    rerender(<NowPlaying />);
    expect(screen.queryByTestId('add-to-playlist-menu')).toBeNull();
  });

  it('closes the sheet and the playlist menu when the player closes without them (Back, Escape)', () => {
    auth.user = { id: 'u1' };
    render(<NowPlaying />);
    openMore();
    act(() => usePlayerStore.getState().setNowPlayingOpen(false));
    expect(screen.queryByTestId('now-playing-more-sheet')).toBeNull();
    act(() => usePlayerStore.getState().setNowPlayingOpen(true));
    openMore();
    fireEvent.click(row('add'));
    act(() => usePlayerStore.getState().setNowPlayingOpen(false));
    expect(screen.queryByTestId('add-to-playlist-menu')).toBeNull();
  });

  it('has no More button with no song', () => {
    player.current = null;
    usePlayerStore.getState().setNowPlayingOpen(false);
    render(<NowPlaying />);
    expect(within(view()).queryByRole('button', { name: 'More' })).toBeNull();
  });
});
