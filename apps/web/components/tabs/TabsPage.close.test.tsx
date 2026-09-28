import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TabSummary } from '@/lib/tabSources';
import type { Track } from '@/types/track';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { TabsPage } from './TabsPage';

// Closing the tab page (the player bar's tabs button a second time, or
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

/** The page with everything on: the score drawn and following the song,
 *  the metronome clicking, a loop over bar 1, the song at 75%, and both
 *  polls running. */
async function openEverything() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <TabsPage trackId="upload:song1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('tab-score')).toHaveAttribute('data-status', 'ready'));
  const alphaTab = at.apis[0];
  act(() => alphaTab.playerReady.fire());

  // Metronome on (enabled once the score's bars are known).
  const metronome = screen.getByRole('button', { name: /Metronome/ });
  await waitFor(() => expect(metronome).toBeEnabled());
  fireEvent.click(metronome);
  expect(metronome).toHaveAttribute('aria-pressed', 'true');

  // Practice: 75% and a loop over bar 1.
  fireEvent.click(screen.getByRole('button', { name: /Practice/ }));
  const practice = screen.getByTestId('tab-practice');
  fireEvent.click(within(practice).getByRole('button', { name: '75%' }));
  fireEvent.change(within(practice).getByLabelText('Loop from bar'), { target: { value: '1' } });
  expect(within(practice).getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');

  // "Line it up" from the Source sheet: the tab list is asked again every 4 s.
  fireEvent.click(screen.getByRole('button', { name: 'Choose a tab' }));
  const lineUp = await screen.findByRole('button', { name: /Line (it|this) up/ });
  fireEvent.click(lineUp);
  await waitFor(() => expect(api.lineTabUp).toHaveBeenCalled());

  // Everything is running: prove it before closing.
  const before = {
    oscillators: audio.oscillators,
    feeds: alphaTab.player.output.updatePosition.mock.calls.length,
    align: api.getTabAlignment.mock.calls.length,
    tabs: api.getTrackTabs.mock.calls.length,
  };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4500);
  });
  expect(audio.oscillators).toBeGreaterThan(before.oscillators);
  expect(alphaTab.player.output.updatePosition.mock.calls.length).toBeGreaterThan(before.feeds);
  expect(api.getTabAlignment.mock.calls.length).toBeGreaterThan(before.align);
  expect(api.getTrackTabs.mock.calls.length).toBeGreaterThan(before.tabs);
  expect(player.setRate).toHaveBeenLastCalledWith(0.75);
  return { view, alphaTab, qc };
}

describe('closing the tab page stops everything it ran', () => {
  it('AlphaTab, metronome, loop, speed and polls all stop; the music is left alone', async () => {
    const { view, alphaTab, qc } = await openEverything();
    const seeksBefore = player.seek.mock.calls.length;

    view.unmount();

    // AlphaTab is destroyed and its resize watch dropped.
    expect(alphaTab.destroy).toHaveBeenCalledTimes(1);
    expect(observers.disconnect).toHaveBeenCalled();
    // The metronome's AudioContext is closed.
    expect(audio.close).toHaveBeenCalledTimes(1);
    expect(audio.contexts.every((c) => c.state === 'closed')).toBe(true);
    // The song is back at full speed.
    expect(player.setRate).toHaveBeenLastCalledWith(1);

    const after = {
      oscillators: audio.oscillators,
      feeds: alphaTab.player.output.updatePosition.mock.calls.length,
      align: api.getTabAlignment.mock.calls.length,
      tabs: api.getTrackTabs.mock.calls.length,
      render: alphaTab.render.mock.calls.length,
    };
    // A minute later: no clicks, no cursor feed, no loop jumps, no polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(audio.oscillators).toBe(after.oscillators);
    expect(alphaTab.player.output.updatePosition.mock.calls.length).toBe(after.feeds);
    expect(alphaTab.render.mock.calls.length).toBe(after.render);
    expect(api.getTabAlignment.mock.calls.length).toBe(after.align);
    expect(api.getTrackTabs.mock.calls.length).toBe(after.tabs);
    expect(player.seek.mock.calls.length).toBe(seeksBefore);

    // Nothing repeating is left: once the query cache's own clean-up
    // timers have run, no timer or frame callback is pending at all.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(qc.getQueryCache().getAll().every((q) => q.getObserversCount() === 0)).toBe(true);

    // The music is not touched: no pause, no stop, no seek.
    expect(player.toggle).not.toHaveBeenCalled();
    expect(player.playTrack).not.toHaveBeenCalled();
  });
});
