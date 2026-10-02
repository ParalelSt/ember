import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SearchOverlayContainer } from './SearchOverlayContainer';
import { useUiStore } from '@/stores/useUiStore';
import type { Track } from '@/types/track';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const pathname = vi.hoisted(() => ({ value: '/' }));
const desktop = vi.hoisted(() => ({ value: true }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));

// @base-ui's Dialog reaches the repo root's hoisted React 18 through its own
// node_modules copy (see BugReportDialog.test.tsx), so render a plain
// element for the chrome: this test is about the overlay's behavior, not
// base-ui's own portal/focus machinery. The stand-ins carry the modal
// markers a real dialog would (a backdrop, aria-modal) so the desktop
// dropdown can be checked for NOT having them.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => (
    <div>
      <div data-slot="dialog-overlay" data-testid="sheet-backdrop" />
      <div data-testid="search-sheet" role="dialog" aria-modal="true">{children}</div>
    </div>
  ),
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

const online = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => online.value }));

const voice = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock('@/hooks/useVoiceSearch', () => ({
  useVoiceSearch: () => ({ supported: false, listening: false, toggle: vi.fn(), cancel: voice.cancel }),
}));

vi.mock('@/components/track/menus/TrackMenu', () => ({
  renderTrackMenu: () => null,
}));

const trackActions = vi.hoisted(() => ({
  currentId: null as string | null,
  isPlaying: false,
  likedIds: new Set<string>(),
  onPlay: vi.fn(),
  onToggle: vi.fn(),
  onLike: vi.fn(),
  artworkSrcFor: vi.fn(() => null),
}));
vi.mock('@/hooks/useTrackActions', () => ({ useTrackActions: () => trackActions }));

const recents = vi.hoisted(() => ({
  tracks: [] as Track[],
  removeMutate: vi.fn(),
  addMutate: vi.fn(),
}));
vi.mock('@/hooks/useRecentSearches', () => ({
  useQueryRecentSearches: () => ({ data: recents.tracks }),
  useExecuteAddRecentSearch: () => ({ mutate: recents.addMutate }),
  useExecuteRemoveRecentSearch: () => ({ mutate: recents.removeMutate }),
}));

// A fetch that never resolves by default: proves opening and typing never
// wait on the network. api.search is swapped per-test where a real response
// is needed.
const api = vi.hoisted(() => ({ search: vi.fn<() => Promise<{ tracks: Track[] }>>() }));
vi.mock('@/lib/api', () => ({ api }));

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: 'art1',
    album: 'Night Shift',
    albumId: 'alb1',
    durationSec: 191,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

/** The overlay plus one ordinary button beside it, standing in for the rest
 *  of the app: on desktop the dropdown covers nothing, so that button has to
 *  stay clickable and is where focus goes back to on Escape. */
function renderOverlay() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <button type="button" data-testid="elsewhere">Play</button>
      <SearchOverlayContainer />
    </QueryClientProvider>,
  );
}

function box() {
  return screen.getByPlaceholderText('What do you want to listen to?');
}

function panel() {
  return screen.queryByTestId('search-dropdown');
}

function neverResolves() {
  return new Promise<{ tracks: Track[] }>(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  api.search.mockImplementation(neverResolves);
  recents.tracks = [];
  trackActions.currentId = null;
  trackActions.isPlaying = false;
  online.value = true;
  pathname.value = '/';
  desktop.value = true;
  useUiStore.setState({ searchOpen: true });
});

describe('SearchOverlayContainer', () => {
  it('opens and focuses the input even with the network completely down', async () => {
    api.search.mockImplementation(neverResolves);
    renderOverlay();

    await waitFor(() => expect(box()).toHaveFocus());
  });

  it('keeps every keystroke while a request is in flight', async () => {
    renderOverlay();
    const input = screen.getByPlaceholderText('What do you want to listen to?');

    fireEvent.change(input, { target: { value: 'd' } });
    fireEvent.change(input, { target: { value: 'da' } });
    fireEvent.change(input, { target: { value: 'daf' } });
    fireEvent.change(input, { target: { value: 'daft' } });

    expect(input).toHaveValue('daft');
  });

  it('renders results through TrackList once the query resolves', async () => {
    const track = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Wind' });
    api.search.mockResolvedValue({ tracks: [track] });
    renderOverlay();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'second wind' },
    });

    expect(await screen.findByText('Second Wind')).toBeInTheDocument();
  });

  it('dismisses on Escape', () => {
    renderOverlay();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it('shows the offline line, and no error, when offline', () => {
    online.value = false;
    renderOverlay();

    expect(
      screen.getByText('No connection. This will run when you are back online.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Searching too fast, one moment.')).toBeNull();
  });

  it('shows recent searches when the box is empty', () => {
    recents.tracks = [makeTrack()];
    renderOverlay();

    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
    expect(screen.queryByText('Trending')).toBeNull();
  });

  it('shows no Trending heading or list with an empty query', () => {
    recents.tracks = [makeTrack()];
    renderOverlay();

    expect(screen.queryByText('Trending')).toBeNull();
    expect(screen.queryByText('No tracks')).toBeNull();
  });

  it('shows a calm line instead of an empty panel when there are no recents either', () => {
    recents.tracks = [];
    renderOverlay();

    expect(screen.getByText('Search for a song, artist or album')).toBeInTheDocument();
    expect(screen.queryByText('Trending')).toBeNull();
    expect(screen.queryByText('No tracks')).toBeNull();
  });

  it('still renders results for an actual query, with no Trending heading', async () => {
    const track = makeTrack({ id: 'youtube:c3', sourceId: 'c3', title: 'Third Wheel' });
    api.search.mockResolvedValue({ tracks: [track] });
    renderOverlay();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'third wheel' },
    });

    expect(await screen.findByText('Third Wheel')).toBeInTheDocument();
    expect(screen.getByText('Results for "third wheel"')).toBeInTheDocument();
    expect(screen.queryByText('Trending')).toBeNull();
  });

  // The search-row controls: both row shapes the overlay shows get the
  // trailing play/pause button and the ember title, off one player.
  it('gives the recents a trailing play button that plays that track', () => {
    recents.tracks = [makeTrack()];
    renderOverlay();

    const button = screen.getByRole('button', { name: 'Play Midnight Drive' });
    fireEvent.click(button);
    expect(trackActions.onPlay).toHaveBeenCalledTimes(1);
    expect(trackActions.onPlay.mock.calls[0][0]).toMatchObject({ id: 'youtube:a1' });
    expect(trackActions.onToggle).not.toHaveBeenCalled();
  });

  it('pauses and resumes the recents row that is the current song', () => {
    recents.tracks = [makeTrack()];
    trackActions.currentId = 'youtube:a1';
    trackActions.isPlaying = true;
    const { rerender } = renderOverlay();

    fireEvent.click(screen.getByRole('button', { name: 'Pause Midnight Drive' }));
    expect(trackActions.onToggle).toHaveBeenCalledTimes(1);
    expect(trackActions.onPlay).not.toHaveBeenCalled();
    expect(screen.getByTestId('track-row-title').className).toContain('text-ember');

    trackActions.isPlaying = false;
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SearchOverlayContainer />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Resume Midnight Drive' })).toBeInTheDocument();
    // Paused looks the same as playing apart from the icon: the title keeps
    // the accent and nothing else marks the row.
    expect(screen.getByTestId('track-row-title').className).toContain('text-ember');
  });

  it('gives the results a trailing play button and the ember title, no glyph', async () => {
    const track = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Wind' });
    trackActions.currentId = 'youtube:b2';
    trackActions.isPlaying = true;
    api.search.mockResolvedValue({ tracks: [track] });
    renderOverlay();

    fireEvent.change(screen.getByPlaceholderText('What do you want to listen to?'), {
      target: { value: 'second wind' },
    });

    expect(await screen.findByRole('button', { name: 'Pause Second Wind' })).toBeInTheDocument();
    const title = screen.getByTestId('track-row-title');
    expect(title.className).toContain('text-ember');
    expect(title.querySelector('svg')).toBeNull();
    // No leading play cell any more: the control is the trailing one.
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });
});

// The desktop shape: a real search box in the page with the results hanging
// under it, and nothing else on screen covered, dimmed or disabled.
describe('SearchOverlayContainer, desktop dropdown', () => {
  it('keeps the search box in the page with the panel closed', () => {
    useUiStore.setState({ searchOpen: false });
    renderOverlay();

    expect(box()).toBeInTheDocument();
    expect(panel()).toBeNull();
  });

  it('is not a modal: no backdrop, no aria-modal, no dialog chrome', () => {
    const { container } = renderOverlay();

    expect(panel()).toBeInTheDocument();
    expect(container.querySelector('[aria-modal]')).toBeNull();
    expect(container.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(screen.queryByTestId('search-sheet')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    // And no X: clicking away is the close, which is only honest because
    // there is something behind it to click.
    expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull();
  });

  // The Trending block used to fill this panel to its cap even with an
  // empty query; dropping it (bc7844b) let the panel shrink to a couple of
  // lines. SearchDropdown pins min-height to the same clamp as the
  // existing max-height cap so the panel comes back to that size instead
  // of collapsing around a short recents list.
  it('pins the panel to a minimum height, not just a maximum', () => {
    renderOverlay();

    const style = panel()!.getAttribute('style') ?? '';
    expect(style).toMatch(/min-height:\s*min\(28rem/);
    expect(style).toMatch(/max-height:\s*min\(28rem/);
  });

  // The box sits in the desktop top bar, sticky INSIDE the page scroller
  // (components/nav/DesktopTopBar), so `--ember-scroller-h` includes the
  // bar. The panel starts at the bar's bottom: without taking the bar's
  // height off, the list would run under the player bar.
  it('takes the top bar off the room the panel may fill', () => {
    renderOverlay();

    const style = panel()!.getAttribute('style') ?? '';
    for (const prop of ['min-height', 'max-height']) {
      expect(style).toMatch(
        new RegExp(`${prop}:\\s*min\\(28rem, calc\\(var\\(--ember-scroller-h, 60vh\\) - var\\(--ember-topbar-h, 0px\\) - 2rem\\)\\)`),
      );
    }
  });

  it('opens and focuses the box on the "/" shortcut, then hands focus back on Escape', async () => {
    useUiStore.setState({ searchOpen: false });
    renderOverlay();
    const elsewhere = screen.getByTestId('elsewhere');
    elsewhere.focus();

    fireEvent.keyDown(elsewhere, { key: '/' });
    expect(useUiStore.getState().searchOpen).toBe(true);
    await waitFor(() => expect(box()).toHaveFocus());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().searchOpen).toBe(false);
    expect(elsewhere).toHaveFocus();
  });

  it('opens when the box is focused', () => {
    useUiStore.setState({ searchOpen: false });
    renderOverlay();

    fireEvent.focus(box());
    expect(useUiStore.getState().searchOpen).toBe(true);
  });

  it('closes on a press outside it', () => {
    renderOverlay();

    fireEvent.pointerDown(screen.getByTestId('elsewhere'));
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it('stays open on a press inside it', () => {
    renderOverlay();

    fireEvent.pointerDown(box());
    expect(useUiStore.getState().searchOpen).toBe(true);
  });

  // The point of the whole change: start a song and keep searching.
  it('does NOT close when a row is played', () => {
    recents.tracks = [makeTrack()];
    renderOverlay();

    const play = screen.getByRole('button', { name: 'Play Midnight Drive' });
    fireEvent.pointerDown(play);
    fireEvent.click(play);

    expect(trackActions.onPlay).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().searchOpen).toBe(true);
    expect(panel()).toBeInTheDocument();
  });

  it('closes when the page navigates', () => {
    const { rerender } = renderOverlay();
    expect(useUiStore.getState().searchOpen).toBe(true);

    pathname.value = '/library';
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <button type="button" data-testid="elsewhere">Play</button>
        <SearchOverlayContainer />
      </QueryClientProvider>,
    );

    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it('shows no clear X with an empty box, just the mic', () => {
    renderOverlay();

    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search by voice' })).toBeInTheDocument();
  });

  it('shows a clear X before the mic once there is text, and keeps the mic', () => {
    renderOverlay();
    fireEvent.change(box(), { target: { value: 'daft' } });

    const clear = screen.getByRole('button', { name: 'Clear search' });
    const mic = screen.getByRole('button', { name: 'Search by voice' });
    // Inside the box, left of the mic.
    expect(screen.getByRole('search')).toContainElement(clear);
    expect(clear.compareDocumentPosition(mic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(clear.className).toMatch(/right-10/);
    expect(mic.className).toMatch(/right-1(\s|$)/);
  });

  it('clears the box on the X, keeping focus in it and the panel open', async () => {
    renderOverlay();
    await waitFor(() => expect(box()).toHaveFocus());
    fireEvent.change(box(), { target: { value: 'daft' } });

    const clear = screen.getByRole('button', { name: 'Clear search' });
    // Pressing it must not pull focus out of the box.
    expect(fireEvent.mouseDown(clear)).toBe(false);
    fireEvent.pointerDown(clear);
    fireEvent.click(clear);

    expect(box()).toHaveValue('');
    expect(box()).toHaveFocus();
    expect(useUiStore.getState().searchOpen).toBe(true);
    expect(panel()).toBeInTheDocument();
    // Gone with the text, mic still there; typing again just works.
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search by voice' })).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: 'd' } });
    expect(box()).toHaveValue('d');
    expect(panel()).toBeInTheDocument();
  });

  it('still closes on Escape with text in the box, text kept', () => {
    renderOverlay();
    fireEvent.change(box(), { target: { value: 'daft' } });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().searchOpen).toBe(false);
    expect(box()).toHaveValue('daft');
  });

  it('stands down on /search, which is the search UI already', () => {
    pathname.value = '/search';
    renderOverlay();

    expect(screen.queryByPlaceholderText('What do you want to listen to?')).toBeNull();
    expect(panel()).toBeNull();
  });
});

// The phone shape: a full-screen modal sheet with a back arrow left of the
// box (closes) and an X inside it that only ever clears.
describe('SearchOverlayContainer, phone sheet', () => {
  beforeEach(() => {
    desktop.value = false;
  });

  it('renders the modal sheet, not the dropdown', () => {
    renderOverlay();

    expect(screen.getByTestId('search-sheet')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('sheet-backdrop')).toBeInTheDocument();
    expect(panel()).toBeNull();
  });

  it('closes on the back arrow, and its box takes focus on open', async () => {
    renderOverlay();

    await waitFor(() => expect(box()).toHaveFocus());
    const back = screen.getByRole('button', { name: 'Close search' });
    // A back arrow left of the box, not an X inside it.
    expect(back.querySelector('.lucide-chevron-left')).not.toBeNull();
    expect(back.querySelector('.lucide-x')).toBeNull();
    expect(back.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(back);
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it('closing the sheet stops voice search, so the mic is not left listening behind it', () => {
    renderOverlay();
    expect(voice.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(voice.cancel).toHaveBeenCalled();
  });

  it('keeps the typed text when the back arrow closes it, same as before', () => {
    renderOverlay();
    fireEvent.change(box(), { target: { value: 'daft' } });

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(useUiStore.getState().searchOpen).toBe(false);
    expect(box()).toHaveValue('daft');
  });

  it('still closes on the Android back gesture', () => {
    renderOverlay();

    fireEvent(window, new PopStateEvent('popstate'));
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it('shows the mic and no X while empty, then only the clear X with text', () => {
    renderOverlay();
    const sheet = screen.getByTestId('search-sheet');

    expect(screen.getByRole('button', { name: 'Search by voice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(sheet.querySelectorAll('.lucide-x')).toHaveLength(0);

    fireEvent.change(box(), { target: { value: 'daft' } });
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search by voice' })).toBeNull();
    // Never two X icons: the only X is the one that clears.
    expect(sheet.querySelectorAll('.lucide-x')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Clear search' }).querySelector('.lucide-x')).not.toBeNull();
  });

  it('clears on the X without closing, focus kept in the box', async () => {
    renderOverlay();
    await waitFor(() => expect(box()).toHaveFocus());
    fireEvent.change(box(), { target: { value: 'daft' } });

    const clear = screen.getByRole('button', { name: 'Clear search' });
    expect(fireEvent.mouseDown(clear)).toBe(false);
    fireEvent.click(clear);

    expect(box()).toHaveValue('');
    expect(box()).toHaveFocus();
    expect(useUiStore.getState().searchOpen).toBe(true);
    expect(screen.getByRole('button', { name: 'Search by voice' })).toBeInTheDocument();
  });

  // (Whether a closed sheet renders nothing is base-ui's Dialog doing its
  // job, and the stand-in above always renders its children, so there is
  // nothing here to assert. The desktop box, which IS always in the page,
  // is covered above.)

  it('shows recents and no Trending heading with an empty query', () => {
    recents.tracks = [makeTrack()];
    renderOverlay();

    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
    expect(screen.queryByText('Trending')).toBeNull();
    expect(screen.queryByText('No tracks')).toBeNull();
  });

  it('shows the calm empty line with no recents', () => {
    recents.tracks = [];
    renderOverlay();

    expect(screen.getByText('Search for a song, artist or album')).toBeInTheDocument();
  });

  it('dismisses on Escape', () => {
    renderOverlay();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().searchOpen).toBe(false);
  });
});
