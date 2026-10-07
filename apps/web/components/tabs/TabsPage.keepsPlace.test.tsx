import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TabSummary } from '@/lib/tabSources';
import type { Track } from '@/types/track';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { TabsPage } from './TabsPage';

// Opening and closing the sheets, switching versions and instruments, and
// Back) unmounts it. Everything the page ran has to stop with it: AlphaTab
// and its cursor feed, the metronome and its AudioContext, the practice
// loop, the practice speed, and the polls for tabs and alignment. The
// music itself plays on.
//
// This renders the real page with the real score component and hooks;
// only AlphaTab, Web Audio, the player and the API are fakes.

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/tabs/upload%3Asong1' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
    DropdownMenuItem: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" role="menuitem" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

const player = vi.hoisted(() => ({
  current: null as Track | null,
  isPlaying: true,
  position: 1,
  duration: 180,
  seek: vi.fn(),
  playTrack: vi.fn(),
  toggle: vi.fn(),
  rate: 1,
  setRate: vi.fn(),
  canSetRate: true,
}));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));

const api = vi.hoisted(() => ({
  getTrackTabs: vi.fn(),
  getTabs: vi.fn(),
  uploadTabFile: vi.fn(),
  deleteTabFile: vi.fn(),
  saveTabOffset: vi.fn(),
  getTrack: vi.fn(),
  listUploads: vi.fn(),
  findTabsOnline: vi.fn(),
  getTabAlignment: vi.fn(),
  lineTabUp: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

// ── a fake AlphaTab: what LiveTabScore calls, with spies ─────────────────
type Handler = (arg?: unknown) => void;
class Emitter {
  fns: Handler[] = [];
  on(fn: Handler) {
    this.fns.push(fn);
  }
  fire(arg?: unknown) {
    this.fns.forEach((f) => f(arg));
  }
}
const at = vi.hoisted(() => ({ apis: [] as FakeApi[] }));
interface FakeApi {
  destroy: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  playerReady: Emitter;
  player: { output: { handler: unknown; updatePosition: ReturnType<typeof vi.fn> } };
}
vi.mock('@coderline/alphatab', () => {
  // Three bars of 4/4: two at 96 bpm, one at 140.
  const masterBars = [
    { start: 0, end: 3840, tempoChanges: [{ tick: 0, tempo: 96 }], masterBar: { index: 0, timeSignatureNumerator: 4, timeSignatureDenominator: 4 } },
    { start: 3840, end: 7680, tempoChanges: [{ tick: 3840, tempo: 96 }], masterBar: { index: 1 } },
    { start: 7680, end: 11520, tempoChanges: [{ tick: 7680, tempo: 140 }], masterBar: { index: 2 } },
  ];
  const score = () => ({
    tempo: 96,
    masterBars: [{ keySignature: -1, keySignatureType: 1 }],
    tracks: [{ index: 0, name: 'Guitar', playbackInfo: { program: 30 }, staves: [{ tuning: [64, 59, 55, 50, 45, 40], showTablature: true }] }],
  });
  class AlphaTabApi {
    scoreLoaded = new Emitter();
    postRenderFinished = new Emitter();
    error = new Emitter();
    playerReady = new Emitter();
    playerPositionChanged = new Emitter();
    beatMouseDown = new Emitter();
    playedBeatChanged = new Emitter();
    midiLoaded = new Emitter();
    player = { output: { handler: null, updatePosition: vi.fn() } };
    settings: Record<string, unknown>;
    play = vi.fn();
    pause = vi.fn();
    render = vi.fn();
    renderTracks = vi.fn();
    updateSettings = vi.fn();
    destroy = vi.fn();
    isReadyForPlayback = true;
    playerState = 0;
    playbackSpeed = 1;
    tickPosition = 0;
    timePosition = 0;
    score: unknown = null;
    tracks: unknown[] = [];
    tickCache = { masterBars, findBeat: () => null };
    renderer = { boundsLookup: { findBeat: () => null } };
    constructor(_host: HTMLElement, settings: Record<string, unknown>) {
      this.settings = settings;
      at.apis.push(this as unknown as FakeApi);
    }
    renderScore(s: { tracks: unknown[] }, tracks: number[]) {
      this.score = s;
      this.tracks = tracks.map((i) => s.tracks[i]);
      this.scoreLoaded.fire(s);
      this.postRenderFinished.fire();
      this.midiLoaded.fire();
    }
  }
  return {
    AlphaTabApi,
    Settings: class {},
    importer: { ScoreLoader: { loadScoreFromBytes: score } },
    PlayerMode: { EnabledExternalMedia: 3 },
    ScrollMode: { Off: 0 },
    StaveProfile: { Tab: 'tab', ScoreTab: 'score-tab' },
    LayoutMode: { Page: 'page', Horizontal: 'horizontal' },
    TabRhythmMode: { ShowWithBars: 'bars' },
    NotationElement: new Proxy({}, { get: (_t, k) => String(k) }),
  };
});

// ── Web Audio and the browser bits AlphaTab's host needs ─────────────────
const audio = { made: 0, oscillators: 0, close: vi.fn(), contexts: [] as { state: string }[] };
class FakeAudioContext {
  state = 'running';
  destination = {};
  constructor() {
    audio.made++;
    audio.contexts.push(this);
  }
  get currentTime() {
    return performance.now() / 1000;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    audio.close();
    return Promise.resolve();
  }
  createOscillator() {
    audio.oscillators++;
    return { frequency: { value: 0 }, type: '', connect: () => {}, start: () => {}, stop: () => {} };
  }
  createGain() {
    return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} };
  }
}
const observers = { disconnect: vi.fn() };
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {
    observers.disconnect();
  }
}

const SONG: Track = {
  id: 'upload:song1',
  source: 'upload',
  sourceId: 'song1',
  title: 'Copper Sky',
  artist: 'Coastline',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 180,
  artworkUrl: null,
  streamUrl: '/x',
};
const TAB: TabSummary = {
  id: 'u1',
  kind: 'fetched',
  title: 'Copper Sky',
  artist: 'Coastline',
  instrument: 'Guitar',
  trackId: 'upload:song1',
  ext: '.gp',
  format: 'gp',
  shared: true,
  mine: false,
  canDelete: false,
  offsetMs: 0,
  addedBy: null,
  downloadUrl: '/api/tabs/files/u1/download',
  source: null,
  timing: null,
};

const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const initialSettings = useSettingsStore.getState();

beforeEach(() => {
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
  vi.clearAllMocks();
  window.localStorage.clear();
  useSettingsStore.setState(initialSettings, true);
  at.apis.length = 0;
  audio.made = 0;
  audio.oscillators = 0;
  audio.contexts.length = 0;
  player.current = SONG;
  player.isPlaying = true;
  player.position = 1;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  api.getTrackTabs.mockResolvedValue({ tabs: [TAB] });
  api.getTabs.mockResolvedValue({ matches: [] });
  api.listUploads.mockResolvedValue({ tracks: [] });
  api.findTabsOnline.mockResolvedValue({ status: 'cached', searchedAt: '2026-09-19T10:00:00Z', added: 0 });
  // A job lining the tab up is running: the page asks every 3 s.
  api.getTabAlignment.mockResolvedValue({ status: 'running' });
  api.lineTabUp.mockResolvedValue({ status: 'running' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth);
});

const ssTab = (id: string, instruments: string[], confidence?: number): TabSummary => ({
  ...TAB,
  id,
  downloadUrl: `/api/tabs/files/${id}/download`,
  source: { site: 'songsterr', siteLabel: 'Songsterr', url: 'https://www.songsterr.com/a/7', part: 'multi', instruments, version: 1, rating: null, votes: null },
  ...(confidence === undefined ? {} : { timing: { offsetMs: 0, bpm: 120, confidence, bars: [] } }),
}) as TabSummary;

async function open() {
  api.getTrackTabs.mockResolvedValue({ tabs: [ssTab('s1', ['Rhythm Guitar', 'Bass'], 0.94), ssTab('s2', ['Rhythm Guitar']), { ...TAB, id: 'f1', kind: 'file', instrument: 'Bass', downloadUrl: '/api/tabs/files/f1/download' }] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <TabsPage trackId="upload:song1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('tab-score')).toHaveAttribute('data-status', 'ready'));
  act(() => at.apis[0].playerReady.fire());
  return view;
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(1500); });
function setSpeedAndLoop() {
  fireEvent.click(screen.getByTestId('tab-tool-speed'));
  fireEvent.click(within(screen.getByTestId('tab-popover-speed')).getByRole('button', { name: '75%' }));
  fireEvent.click(screen.getByTestId('tab-tool-loop'));
  const practice = screen.getByTestId('tab-popover-loop');
  fireEvent.change(within(practice).getByLabelText('Loop from bar'), { target: { value: '1' } });
  fireEvent.click(screen.getByTestId('tab-tool-loop'));
}
/** Nothing that moves, starts, stops or reloads the song was called. */
function expectTransportUntouched() {
  expect(player.seek).not.toHaveBeenCalled();
  expect(player.toggle).not.toHaveBeenCalled();
  expect(player.playTrack).not.toHaveBeenCalled();
  expect(player.position).toBe(73);
  expect(player.isPlaying).toBe(true);
  expect(player.current).toBe(SONG);
}

describe('the tab page keeps the song and its own place', () => {
  beforeEach(() => {
    player.position = 73;
    player.isPlaying = true;
    player.setRate.mockImplementation((r: number) => { player.rate = r; });
    player.rate = 1;
  });

  it('opening and closing the tab list, the instrument tiles and the sheet leave the song alone', async () => {
    await open();
    setSpeedAndLoop();
    player.seek.mockClear();
    player.setRate.mockClear();
    const speedCalls = player.setRate.mock.calls.length;

    // Open, look at another instrument, close with the X.
    fireEvent.click(screen.getByRole('button', { name: 'Choose a tab' }));
    const sheet = await screen.findByTestId('tab-source-sheet');
    const tiles = within(sheet).getAllByTestId('tab-instrument-tile');
    expect(tiles.length).toBeGreaterThan(1);
    fireEvent.click(tiles[tiles.length - 1]);
    fireEvent.click(within(screen.getByTestId('tab-source-sheet')).getAllByRole('button', { name: 'Close the tab list' })[0]);
    await settle();
    expect(screen.queryByTestId('tab-source-sheet')).toBeNull();

    // Open and close again by the toolbar button (a toggle).
    fireEvent.click(screen.getByRole('button', { name: 'Choose a tab' }));
    await screen.findByTestId('tab-source-sheet');
    fireEvent.click(screen.getByRole('button', { name: 'Choose a tab' }));
    await settle();

    expectTransportUntouched();
    expect(player.setRate.mock.calls.length).toBe(speedCalls);
    expect(player.rate).toBe(0.75);
    // The loop is still on and the version was not changed by looking.
    fireEvent.click(screen.getByTestId('tab-tool-loop'));
    expect(within(screen.getByTestId('tab-popover-loop')).getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
    expect(at.apis.length).toBe(1);
  });

  it('switching version and instrument keeps the song where it is and the speed set', async () => {
    await open();
    setSpeedAndLoop();
    player.seek.mockClear();
    player.setRate.mockClear();

    // Pick each instrument's last-listed version in turn (a different tab each time).
    const pickVia = async (tileIndex: number) => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose a tab' }));
      const sheet = await screen.findByTestId('tab-source-sheet');
      const tiles = within(sheet).getAllByTestId('tab-instrument-tile');
      expect(tiles.length).toBeGreaterThan(tileIndex);
      fireEvent.click(tiles[tileIndex]);
      const rows = within(screen.getByTestId('tab-source-sheet')).getAllByTestId('tab-source-row');
      fireEvent.click(within(rows[rows.length - 1]).getByRole('radio'));
      await waitFor(() => expect(screen.queryByTestId('tab-source-sheet')).toBeNull());
      await waitFor(() => expect(screen.getByTestId('tab-score')).toHaveAttribute('data-status', 'ready'));
      await settle();
    };
    await pickVia(1);
    expect(at.apis.length).toBeGreaterThan(1); // a different tab was really drawn
    await pickVia(0);
    await pickVia(1);

    expectTransportUntouched();
    // Speed stays at 75% and is never dropped to 1 in between.
    expect(player.setRate.mock.calls.every(([r]) => r === 0.75)).toBe(true);
    expect(player.rate).toBe(0.75);
  });

  it('closing the page and coming back leaves the song playing where it was', async () => {
    const first = await open();
    first.unmount();
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.toggle).not.toHaveBeenCalled();
    expect(player.playTrack).not.toHaveBeenCalled();
    expect(player.position).toBe(73);
    expect(player.isPlaying).toBe(true);
    // Back at full speed on the way out, as designed.
    expect(player.rate).toBe(1);

    at.apis.length = 0;
    await open();
    await settle();
    expectTransportUntouched();
  });
});
