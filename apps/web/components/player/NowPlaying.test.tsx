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
vi.mock('@/components/ui/slider', () => import('@/test-utils/sliderMock'));
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
const player = vi.hoisted(() => ({ startRadio: vi.fn(), toggle: vi.fn(), next: vi.fn(), prev: vi.fn(), current: null as unknown }));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({
    current: player.current,
    isPlaying: true,
    duration: 180,
    toggle: player.toggle,
    next: player.next,
    prev: player.prev,
    seek: () => {},
    startRadio: player.startRadio,
  }),
  // The store's own playhead, read the way the real hook reads it.
  usePlayerPosition: () => usePlayerStore((s) => s.position),
}));
const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: auth.user }) }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), toasts) }));
const blocked = vi.hoisted(() => ({ is: false }));
const blocking = vi.hoisted(() => ({ block: vi.fn(async () => {}), unblock: vi.fn(async () => {}) }));
vi.mock('@/hooks/useBlockedTracks', () => ({
  useBlockedTracks: () => ({ isBlocked: () => blocked.is, block: blocking.block, unblock: blocking.unblock }),
}));
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
vi.mock('@/components/player/SeekBar', () => ({ SeekBar: Stub, PlayheadSeekBar: Stub }));
// The lyrics card: here it only has to show whether its report form is open.
vi.mock('@/components/player/LyricsBody', () => ({
  LyricsBody: ({ reportOpen }: { reportOpen?: boolean }) => (reportOpen ? <div data-testid="lyrics-report" /> : null),
}));
const summaryRendered = vi.hoisted(() => vi.fn(() => null));
vi.mock('@/components/player/NowPlayingSummary', () => ({ NowPlayingSummary: summaryRendered }));

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
const openMore = () => fireEvent.click(within(view()).getByRole('button', { name: 'Options' }));
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
  toasts.success.mockClear();
  toasts.error.mockClear();
  blocked.is = false;
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

// The song's own page from the full-screen player: both the cover and the
// title open it, the view closing first (it is phone-only, md:hidden).
describe('NowPlaying: the song page', () => {
  it('tapping the cover closes the view and opens /track/<id>', async () => {
    render(<NowPlaying />);
    fireEvent.click(within(view()).getByTestId('now-playing-cover'));
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/track/v1'));
  });

  // The title lives in NowPlayingSummary (stubbed here): the view hands it
  // the opener, and its own test shows the title calls it.
  const titleOpener = () =>
    (summaryRendered.mock.calls.at(-1) as unknown as [{ onTitleOpen?: () => void }] | undefined)?.[0].onTitleOpen;

  it('tapping the title does the same', async () => {
    render(<NowPlaying />);
    act(() => titleOpener()!());
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(false);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/track/v1'));
  });

  it('a song with no page (an upload) keeps a plain cover and title', () => {
    player.current = { ...TRACK, source: 'upload', sourceId: 'u1' };
    render(<NowPlaying />);
    expect(within(view()).queryByTestId('now-playing-cover')).toBeNull();
    expect(titleOpener()).toBeUndefined();
  });
});

describe('NowPlaying: the top row', () => {
  it('is the close chevron, the "Playing from" title and one Options button, nothing else', () => {
    auth.user = { id: 'u1' };
    player.current = { ...TRACK, artistId: 'UC1' };
    usePlayerStore.setState({ context: { type: 'playlist', playlistId: 'p1', playlistName: 'Road trip' } });
    render(<NowPlaying />);
    expect(screen.getByTestId('context-title')).toHaveTextContent('Playing from playlistRoad trip');
    expect(within(view()).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(view()).getAllByRole('button', { name: 'Options' })).toHaveLength(1);
    // On the player itself: Like, Devices and Lyrics, and nothing else.
    for (const name of ['Like', 'Devices', 'Queue', 'Lyrics']) {
      expect(within(view()).getAllByRole('button', { name })).toHaveLength(1);
    }
    for (const name of ['Equalizer', 'Guitar tabs', 'Up next']) {
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
    // One of the player's own sheets: its keyboard shortcuts keep working.
    expect(sheet()).toHaveAttribute('data-player-view');
    expect(rows()).toEqual(['radio', 'add', 'tabs', 'eq', 'share', 'artist', 'album', 'block', 'report']);
    expect(sheet().querySelectorAll('[role="group"]')).toHaveLength(0);
    expect(row('share')).toHaveTextContent('Copy link');
    // Like, Lyrics and Devices are on the player, not in the sheet.
    expect(within(sheet()).queryByText(/^(Like|Liked|Lyrics|Devices)$/)).toBeNull();
  });

  it('Start radio starts radio from the song playing', () => {
    auth.user = { id: 'u1' };
    player.current = TRACK;
    render(<NowPlaying />);
    openMore();
    fireEvent.click(row('radio'));
    expect(player.startRadio).toHaveBeenCalledWith(expect.objectContaining({ id: TRACK.id }));
  });

  it('Block song blocks the song playing (owner request 2026-10-22)', () => {
    auth.user = { id: 'u1' };
    render(<NowPlaying />);
    openMore();
    fireEvent.click(row('block'));
    expect(blocking.block).toHaveBeenCalledWith(expect.objectContaining({ id: TRACK.id }));
  });

  it('Block song that the server refuses says so, instead of failing silently', async () => {
    auth.user = { id: 'u1' };
    blocking.block.mockRejectedValueOnce(new Error('network down'));
    render(<NowPlaying />);
    openMore();
    fireEvent.click(row('block'));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't block")));
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('Unblock song that the server refuses says so too', async () => {
    auth.user = { id: 'u1' };
    blocking.unblock.mockRejectedValueOnce(new Error('network down'));
    blocked.is = true;
    render(<NowPlaying />);
    openMore();
    fireEvent.click(row('block'));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't unblock")));
  });

  it('signed out, keeps what needs no account', () => {
    render(<NowPlaying />);
    openMore();
    expect(rows()).toEqual(['radio', 'tabs', 'eq', 'share']);
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

  it('Queue on the player opens the queue sheet; the Options menu no longer lists it', () => {
    render(<NowPlaying />);
    fireEvent.click(within(view()).getByRole('button', { name: 'Queue' }));
    expect(screen.getByTestId('queue-sheet')).toBeInTheDocument();
    expect(usePlayerStore.getState().nowPlayingOpen).toBe(true);
    openMore();
    expect(within(sheet()).queryByText('Queue')).toBeNull();
    expect(screen.queryByTestId('more-queue')).toBeNull();
    expect(within(view()).queryByRole('button', { name: 'More' })).toBeNull();
    expect(within(view()).getByRole('button', { name: 'Options' })).toHaveAttribute('title', 'Options');
  });

  it('the action row is icon-only: Queue at the left edge, Lyrics at the right, Devices between', () => {
    render(<NowPlaying />);
    const row = screen.getByTestId('player-action-row');
    expect(row).toHaveClass('grid', 'grid-cols-[1fr_auto_1fr]');
    const [left, middle, right] = Array.from(row.children) as HTMLElement[];
    expect(within(left).getByRole('button', { name: 'Queue' })).toHaveTextContent('');
    expect(within(right).getByRole('button', { name: 'Lyrics' })).toHaveTextContent('');
    expect(left).toHaveClass('justify-start');
    expect(middle).toHaveClass('justify-center');
    expect(right).toHaveClass('justify-end');
  });

  it('the Options sheet says Options at the top', () => {
    render(<NowPlaying />);
    fireEvent.click(within(view()).getByRole('button', { name: 'Options' }));
    expect(screen.getByTestId('now-playing-options-heading')).toHaveTextContent('Options');
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
    expect(within(panel).queryByRole('group', { name: 'Presets' })).toBeNull();
    fireEvent.click(within(panel).getByRole('switch', { name: 'Turn on Equalizer' }));
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
    expect(within(view()).queryByRole('button', { name: 'Options' })).toBeNull();
  });
});

afterEach(() => vi.unstubAllGlobals());
it.each(['narrow', 'native'])('hides guitar tabs on %s devices with the plugin enabled', (device) => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: device === 'narrow' && q === '(max-width: 767px)', addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('Capacitor', { isNativePlatform: () => device === 'native' });
  render(<NowPlaying />);
  openMore();
  expect(rows()).not.toContain('tabs');
});

describe('NowPlaying on playhead reports', () => {
  it('re-renders only its seek bar, not the whole view (it stays mounted while closed too)', () => {
    usePlayerStore.setState({ position: 0, duration: 180 });
    render(<NowPlaying />);
    const before = summaryRendered.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    for (let s = 1; s <= 5; s += 0.25) act(() => usePlayerStore.getState().reportPosition(s));
    expect(summaryRendered).toHaveBeenCalledTimes(before);
  });
});

// The collection page's Shuffle play only ever re-deals, so this button is
// the one way to turn shuffle off: it must be there for every list that can
// be shuffled (not only playlists) and a real on/off toggle.
describe('NowPlaying: the shuffle button', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...TRACK, id, sourceId: id }));
  const ids = () => usePlayerStore.getState().queue.map((s) => s.id);

  it.each([
    [{ type: 'liked' }],
    [{ type: 'playlist', playlistId: 'p1', playlistName: 'P' }],
    [{ type: 'album', albumId: 'a', albumTitle: 'A' }],
    [{ type: 'chart', chartSlug: 'x', chartTitle: 'X' }],
    [{ type: 'mix', mixKey: 'k', mixTitle: 'K' }],
    [{ type: 'history' }],
    [{ type: 'uploads' }],
    [{ type: 'artist', artistName: 'B' }],
  ] as const)('turns shuffle on, then OFF on the second press, in a %o list', (context) => {
    player.current = list[1];
    usePlayerStore.setState({ queue: list, index: 1, context: context as never, shuffle: false, orderBackup: null });
    render(<NowPlaying />);
    fireEvent.click(within(view()).getByRole('button', { name: 'Shuffle' }));
    expect(usePlayerStore.getState().shuffle).toBe(true);
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe('b');
    fireEvent.click(within(view()).getByRole('button', { name: 'Shuffle off' }));
    expect(usePlayerStore.getState().shuffle).toBe(false);
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(usePlayerStore.getState().index).toBe(1);
    expect(within(view()).getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('stays out of a search, radio, stations or single-song queue, unless shuffle is on', () => {
    player.current = list[1];
    usePlayerStore.setState({ queue: list, index: 1, context: { type: 'search' }, shuffle: false, orderBackup: null });
    const { rerender } = render(<NowPlaying />);
    expect(within(view()).queryByRole('button', { name: 'Shuffle' })).toBeNull();
    act(() => usePlayerStore.setState({ shuffle: true, orderBackup: list }));
    rerender(<NowPlaying />);
    expect(within(view()).getByRole('button', { name: 'Shuffle off' })).toBeInTheDocument();
  });
});
