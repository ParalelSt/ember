import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TabSummary } from '@/lib/tabSources';
import type { Track } from '@/types/track';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { LiveTabScoreProps } from './LiveTabScore';
import { TabsPage } from './TabsPage';
import { toast } from 'sonner';
import { buildTimeline } from '@/lib/tabTimeline';

// The page around the score: which tab it picks, what the header says, the
// empty states, the toolbar toggles and following the player. The score
// itself is a stub that shows the props it was handed (LiveTabScore has its
// own test with a fake AlphaTab).

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));

// next/link reads the app router context, which no test renders, and next
// itself is hoisted to the repo root where it resolves React 18. The
// turned-off state only needs the anchor.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const player = vi.hoisted(() => ({
  current: null as Track | null,
  isPlaying: true,
  position: 12,
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
  addTabText: vi.fn(),
  deleteTabFile: vi.fn(),
  saveTabOffset: vi.fn(),
  getTrack: vi.fn(),
  listUploads: vi.fn(),
  findTabsOnline: vi.fn(),
  getTabAlignment: vi.fn(),
  lineTabUp: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

// @base-ui's Menu reaches the repo root's hoisted React through its own
// require, so the menu is plain elements here: the trigger is a button,
// items are buttons, always rendered.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: ({ children, ...p }: { children?: ReactNode; 'aria-label'?: string }) => (
      <button type="button" aria-label={p['aria-label']}>
        {children}
      </button>
    ),
    DropdownMenuItem: ({ children, onClick, disabled }: { children?: ReactNode; onClick?: () => void; disabled?: boolean }) => (
      <button type="button" role="menuitem" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

const score = vi.hoisted(() => ({ last: null as LiveTabScoreProps | null }));
vi.mock('@/components/tabs/LiveTabScore', () => ({
  LiveTabScore: (p: LiveTabScoreProps) => {
    score.last = p;
    return (
      <div
        data-testid="tab-score"
        data-url={p.url}
        data-scroll={p.scroll}
        data-staff={p.staff}
        data-track={p.track}
        data-scale={p.scale}
        data-follows={String(p.follows)}
        data-offset={p.offsetMs}
        data-rate={p.rate}
        data-highlight={p.highlight ? `${p.highlight.start}-${p.highlight.end}` : ''}
        data-picking={String(!!p.onBarPick)}
      />
    );
  },
}));


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

function tab(over: Partial<TabSummary>): TabSummary {
  return {
    id: 'f1',
    kind: 'file',
    title: 'Copper Sky',
    artist: 'Coastline',
    instrument: null,
    trackId: 'upload:song1',
    ext: '.gp',
    format: 'gp',
    shared: true,
    mine: false,
    canDelete: false,
    offsetMs: 0,
    addedBy: 'Mira',
    downloadUrl: '/api/tabs/files/f1/download',
    ...over,
  };
}

let phone = false;
function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const initialSettings = useSettingsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useSettingsStore.setState(initialSettings, true);
  phone = false;
  window.matchMedia = ((q: string) => ({
    matches: phone && q.includes('max-width'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  player.current = SONG;
  player.isPlaying = true;
  player.position = 12;
  player.rate = 1;
  player.canSetRate = true;
  score.last = null;
  api.getTrackTabs.mockResolvedValue({ tabs: [] });
  api.getTabs.mockResolvedValue({ matches: [] });
  api.listUploads.mockResolvedValue({ tracks: [] });
  api.findTabsOnline.mockResolvedValue({ status: 'cached', searchedAt: '2026-09-19T10:00:00Z', added: 0 });
  api.getTabAlignment.mockResolvedValue({ status: 'none' });
  api.lineTabUp.mockResolvedValue({ status: 'running' });
});

describe('TabsPage source selection', () => {
  it('draws the file someone added, never a generated tab an older server still lists', async () => {
    api.getTrackTabs.mockResolvedValue({
      tabs: [tab({ id: 'g1', kind: 'generated' as never, downloadUrl: '/api/tabs/generated/upload%3Asong1' }), tab({})],
    });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-url', '/api/tabs/files/f1/download');
    expect(screen.getByTestId('tab-source-chip')).toHaveTextContent('File added by Mira, shared');
    expect(screen.getByRole('heading', { name: 'Copper Sky' })).toBeInTheDocument();
    // The chip opens the Source sheet, which lists the file alone.
    fireEvent.click(screen.getByRole('button', { name: 'Choose a tab' }));
    expect(screen.getAllByTestId('tab-source-row')).toHaveLength(1);
    expect(screen.queryByText(/Generated/)).toBeNull();
  });

  it('asks for the whole chain of the playing track', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await waitFor(() => expect(api.getTrackTabs).toHaveBeenCalledWith('upload:song1', 'Copper Sky', 'Coastline'));
  });

  it('a song whose only tab was generated gets the empty state, not the rough score', async () => {
    api.getTrackTabs.mockResolvedValue({
      tabs: [tab({ id: 'g1', kind: 'generated' as never, addedBy: null, downloadUrl: '/api/tabs/generated/upload%3Asong1' })],
    });
    wrap(<TabsPage trackId="upload:song1" />);
    await waitFor(() => expect(screen.getByTestId('tabs-empty')).toHaveAttribute('data-state', 'none'));
    expect(screen.queryByTestId('tab-score')).toBeNull();
    expect(screen.queryByTestId('tab-source-chip')).toBeNull();
  });

  it('a stale pick of a generated tab (saved on this device) falls back to the real one', async () => {
    window.localStorage.setItem('ember.tab.pick.upload:song1', 'g1');
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({ id: 'g1', kind: 'generated' as never }), tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-url', '/api/tabs/files/f1/download');
    expect(screen.getByTestId('tab-source-chip')).toHaveTextContent('File added by Mira, shared');
  });

  it('uses the tab’s shared offset, and this device’s nudge over it', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({ offsetMs: 1200 })] });
    const { unmount } = wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-offset', '1200');
    unmount();
    window.localStorage.setItem('ember.tab.offset.f1', '-0.5');
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-offset', '-500');
  });

  it('the Sync slider changes the offset the score gets', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(await screen.findByTestId('tab-tool-delay'));
    fireEvent.change(screen.getByLabelText('Tab timing offset in seconds'), { target: { value: '2.5' } });
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-offset', '2500');
    expect(window.localStorage.getItem('ember.tab.offset.f1')).toBe('2.5');
  });

  it('Save for everyone that the server refuses says so, and keeps the nudge on this device', async () => {
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({ canDelete: true })] });
    api.saveTabOffset.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(await screen.findByTestId('tab-tool-delay'));
    fireEvent.change(screen.getByLabelText('Tab timing offset in seconds'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save for everyone' }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-offset', '2500');
    error.mockRestore();
  });

  it('takes an exact nudge far past the old 10 s, typed or stepped', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(await screen.findByTestId('tab-tool-delay'));
    fireEvent.change(screen.getByLabelText('Tab timing offset, exact seconds'), { target: { value: '-95.25' } });
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-offset', '-95250');
    expect(window.localStorage.getItem('ember.tab.offset.f1')).toBe('-95.25');
    // The slider widened to show it.
    const slider = screen.getByLabelText('Tab timing offset in seconds');
    expect(Number(slider.getAttribute('min'))).toBeLessThanOrEqual(-95.25);
    fireEvent.click(screen.getByRole('button', { name: '+0.1 s' }));
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-offset', '-95150');
    expect(screen.getByTestId('tab-tool-delay')).toHaveTextContent('-95.15 s');
  });

  it('counts the nudge in beats of the tab: its tempo and time signature', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(await screen.findByTestId('tab-tool-delay'));
    // No score drawn yet: no tempo, so no beats.
    expect(screen.getByRole('button', { name: 'beats' })).toBeDisabled();
    act(() =>
      score.last!.onScore?.({
        tempo: 120,
        signature: { numerator: 3, denominator: 4 },
        key: null,
        tracks: [{ index: 0, name: 'Guitar', instrument: 'Guitar', tuning: '', strings: '', tab: true }],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'beats' }));
    fireEvent.change(screen.getByLabelText('Tab timing offset in beats'), { target: { value: '8' } });
    // 8 quarter notes at 120 bpm.
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-offset', '4000');
    expect(screen.getByTestId('tab-tool-delay')).toHaveTextContent('+8 beats');
    // A bar of 3/4 is three beats.
    fireEvent.click(screen.getByRole('button', { name: '-1 bar' }));
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-offset', '2500');
    expect(screen.getByTestId('tab-sync-beat')).toHaveTextContent('1 beat = 500 ms at 120 bpm, 3/4');
    expect(window.localStorage.getItem('ember.tabs.offsetUnit')).toBe('beats');
  });
});

describe('TabsPage metronome', () => {
  /** Two bars at 96, then two at 140 (AlphaTab's tick lookup). */
  const timeline = () =>
    buildTimeline([
      { start: 0, end: 3840, tempoChanges: [{ tick: 0, tempo: 96 }], masterBar: { index: 0, timeSignatureNumerator: 4, timeSignatureDenominator: 4 } },
      { start: 3840, end: 7680, tempoChanges: [{ tick: 3840, tempo: 96 }], masterBar: { index: 1 } },
      { start: 7680, end: 11520, tempoChanges: [{ tick: 7680, tempo: 140 }], masterBar: { index: 2 } },
    ]);

  it('follows the tab tempo, and takes a tempo of the listener when the tab is wrong', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    player.position = 1;
    wrap(<TabsPage trackId="upload:song1" />);
    const cell = await screen.findByTestId('tab-tool-click');
    expect(cell).toHaveTextContent('Off');
    fireEvent.click(cell);
    const pop = screen.getByTestId('tab-popover-click');
    const sw = within(pop).getByRole('button', { name: 'Metronome' });
    // Nothing to click on until the tab is drawn.
    expect(sw).toBeDisabled();
    act(() => score.last!.onTimeline!(timeline()));
    expect(sw).toBeEnabled();
    expect(within(pop).getByTestId('tab-metronome-bpm')).toHaveTextContent('96 bpm');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-pressed', 'true');
    expect(cell).toHaveTextContent('96');
    expect(screen.getByTestId('tab-metronome-status')).toHaveTextContent('Follows the tab: 96 bpm here (tempo changes 96 → 140).');

    fireEvent.change(screen.getByLabelText('Metronome bpm'), { target: { value: '104' } });
    expect(screen.getByTestId('tab-metronome-status')).toHaveTextContent('Clicking at 104 bpm; the tab says 96 bpm here.');
    expect(cell).toHaveTextContent('104');
    expect(window.localStorage.getItem('ember.tab.bpm.f1')).toBe('104');

    // The steps go one bpm at a time.
    fireEvent.click(screen.getByRole('button', { name: 'Faster click' }));
    expect(cell).toHaveTextContent('105');
    fireEvent.click(screen.getByRole('button', { name: 'Slower click' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slower click' }));
    expect(window.localStorage.getItem('ember.tab.bpm.f1')).toBe('103');

    fireEvent.click(screen.getByRole('button', { name: 'Use the tab’s tempo' }));
    expect(screen.getByTestId('tab-metronome-status')).toHaveTextContent('Follows the tab');
    expect(window.localStorage.getItem('ember.tab.bpm.f1')).toBeNull();
  });

  it('shows the tempo where the song is: past the change it is 140', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    // 7680 ticks at 96 bpm is 5 s.
    player.position = 6;
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    act(() => score.last!.onTimeline!(timeline()));
    fireEvent.click(screen.getByTestId('tab-tool-click'));
    expect(screen.getByTestId('tab-metronome-bpm')).toHaveTextContent('140 bpm');
  });

  it('a tempo set before for this tab is remembered', async () => {
    window.localStorage.setItem('ember.tab.bpm.f1', '88');
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    act(() => score.last!.onTimeline!(timeline()));
    fireEvent.click(screen.getByTestId('tab-tool-click'));
    expect(screen.getByTestId('tab-metronome-bpm')).toHaveTextContent('88 bpm');
  });
});

describe('TabsPage practice', () => {
  /** Eight bars of 4/4 at 120: "Intro" at bar 1, "Verse" at 3, "Chorus" at 7. */
  const timeline = () =>
    buildTimeline(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        start: i * 3840,
        end: (i + 1) * 3840,
        tempoChanges: [{ tick: i * 3840, tempo: 120 }],
        masterBar: {
          index: i,
          timeSignatureNumerator: 4,
          timeSignatureDenominator: 4,
          section: ({ 0: { text: 'Intro' }, 2: { text: 'Verse' }, 6: { text: 'Chorus' } } as Record<number, { text: string }>)[i] ?? null,
        },
      })),
    );

  async function open(tool: 'speed' | 'loop' = 'loop') {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    act(() => score.last!.onTimeline!(timeline()));
    fireEvent.click(screen.getByTestId(`tab-tool-${tool}`));
    return screen.getByTestId(`tab-popover-${tool}`);
  }

  it('five cells over the tab on a wide screen, with their names and values', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    const bar = await screen.findByRole('toolbar', { name: 'Practice' });
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Speed100%',
      'LoopOff',
      'ClickOff',
      '1234Count-in1 bar',
      'Delay0 s',
    ]);
    // In the sticky part with the title line, not floating at the bottom.
    expect(screen.getByTestId('tabs-sticky')).toContainElement(bar);
    // One popover at a time; the same cell again closes it.
    fireEvent.click(screen.getByTestId('tab-tool-speed'));
    expect(screen.getByTestId('tab-popover-speed')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tab-tool-delay'));
    expect(screen.queryByTestId('tab-popover-speed')).toBeNull();
    expect(screen.getByTestId('tab-popover-delay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tab-tool-delay'));
    expect(screen.queryByTestId('tab-popover-delay')).toBeNull();
  });

  it('a press outside the popover, or Escape, closes it', async () => {
    await open('speed');
    fireEvent.pointerDown(screen.getByTestId('tab-score'));
    expect(screen.queryByTestId('tab-popover-speed')).toBeNull();
    fireEvent.click(screen.getByTestId('tab-tool-speed'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('tab-popover-speed')).toBeNull();
  });

  it('slows the song down by percent, pitch kept by the player, and back to full speed on leaving', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    const view = wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    fireEvent.click(screen.getByTestId('tab-tool-speed'));
    fireEvent.click(screen.getByRole('button', { name: '75%' }));
    expect(player.setRate).toHaveBeenLastCalledWith(0.75);
    expect(screen.getByTestId('tab-tool-speed')).toHaveTextContent('75%');
    // The pill says the same.
    expect(within(screen.getByTestId('tab-pill')).getByRole('button', { name: /^Speed/ })).toHaveTextContent('75%');
    view.unmount();
    expect(player.setRate).toHaveBeenLastCalledWith(1);
  });

  it('or by tempo: 90 bpm of a 120 bpm tab is 75%', async () => {
    const pop = await open('speed');
    fireEvent.change(within(pop).getByLabelText('Speed in bpm'), { target: { value: '90' } });
    expect(player.setRate).toHaveBeenLastCalledWith(0.75);
    fireEvent.change(within(pop).getByLabelText('Speed in percent'), { target: { value: '50' } });
    expect(player.setRate).toHaveBeenLastCalledWith(0.5);
  });

  it('the cursor and the metronome get the speed the player plays at', async () => {
    player.rate = 0.6;
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-rate', '0.6');
  });

  it('an engine that cannot change speed says so instead', async () => {
    player.canSetRate = false;
    const pop = await open('speed');
    expect(within(pop).getByTestId('tab-speed-unavailable')).toBeInTheDocument();
    expect(within(pop).queryByRole('button', { name: '75%' })).toBeNull();
    expect(player.setRate).not.toHaveBeenCalled();
  });

  it('loops a section from its shortcut: marked on the score, named on the cell', async () => {
    const pop = await open();
    const sw = within(pop).getByRole('button', { name: 'Loop' });
    expect(sw).toBeDisabled();
    fireEvent.click(within(pop).getByRole('button', { name: 'Verse' }));
    expect(sw).toHaveAttribute('aria-pressed', 'true');
    expect(within(pop).getByRole('button', { name: 'Verse' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-highlight', '2-5');
    expect(screen.getByTestId('tab-tool-loop')).toHaveTextContent('Bars 3–6');
    expect((within(pop).getByLabelText('Loop from bar') as HTMLInputElement).value).toBe('3');
    expect((within(pop).getByLabelText('Loop to bar') as HTMLInputElement).value).toBe('6');
    // Off keeps the bars for next time, and takes the mark away.
    fireEvent.click(sw);
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-highlight', '');
    expect(screen.getByTestId('tab-tool-loop')).toHaveTextContent('Off');
    fireEvent.click(sw);
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-highlight', '2-5');
    fireEvent.click(within(pop).getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-highlight', '');
  });

  it('loops bars typed in, and seeks to the loop when it starts outside it', async () => {
    player.position = 1;
    const pop = await open();
    fireEvent.change(within(pop).getByLabelText('Loop from bar'), { target: { value: '5' } });
    fireEvent.change(within(pop).getByLabelText('Loop to bar'), { target: { value: '6' } });
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-highlight', '4-5');
    // Bar 5 starts 8 s into the tab, which starts with the song.
    await waitFor(() => expect(player.seek).toHaveBeenLastCalledWith(8));
  });

  it('picks the loop on the tab with two clicks, the popover out of the way', async () => {
    const pop = await open();
    fireEvent.click(within(pop).getByRole('button', { name: 'Pick bars on the tab' }));
    expect(screen.queryByTestId('tab-popover-loop')).toBeNull();
    expect(screen.getByTestId('tab-loop-picking')).toHaveTextContent('Click the first bar');
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-picking', 'true');
    act(() => score.last!.onBarPick!(6));
    expect(screen.getByTestId('tab-loop-picking')).toHaveTextContent('Now click its last bar');
    act(() => score.last!.onBarPick!(3));
    expect(screen.queryByTestId('tab-loop-picking')).toBeNull();
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-picking', 'false');
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-highlight', '3-6');
    expect(screen.getByTestId('tab-tool-loop')).toHaveTextContent('Bars 4–7');
  });

  it('the banner cancels picking', async () => {
    const pop = await open();
    fireEvent.click(within(pop).getByRole('button', { name: 'Pick bars on the tab' }));
    fireEvent.click(within(screen.getByTestId('tab-loop-picking')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('tab-loop-picking')).toBeNull();
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-picking', 'false');
  });
});

describe('TabsPage count-in', () => {
  /** Four bars of 4/4 at 120: a beat is half a second. */
  const timeline = () =>
    buildTimeline(
      [0, 1, 2, 3].map((i) => ({
        start: i * 3840,
        end: (i + 1) * 3840,
        tempoChanges: [{ tick: i * 3840, tempo: 120 }],
        masterBar: { index: i, timeSignatureNumerator: 4, timeSignatureDenominator: 4 },
      })),
    );

  beforeEach(() => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    player.isPlaying = false;
    player.position = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The page drawn, then the clock faked when `fake` (the count runs on
   *  timeouts). */
  async function ready(fake = false) {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    act(() => score.last!.onTimeline!(timeline()));
    if (fake) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  }

  it('Play on the pill counts one bar in, then starts the song', async () => {
    {
      await ready(true);
      fireEvent.click(within(screen.getByTestId('tab-pill')).getByRole('button', { name: 'Play' }));
      expect(player.toggle).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByTestId('tab-pill-bar')).toHaveTextContent('Count 1');
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByTestId('tab-pill-bar')).toHaveTextContent('Count 3');
      act(() => vi.advanceTimersByTime(1000));
      expect(player.toggle).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('tab-pill-bar')).toHaveTextContent('Bar 1 / 4');
    }
  });

  it('a second press during the count stops it, and the song does not start', async () => {
    {
      await ready(true);
      const pill = screen.getByTestId('tab-pill');
      fireEvent.click(within(pill).getByRole('button', { name: 'Play' }));
      act(() => vi.advanceTimersByTime(600));
      fireEvent.click(within(pill).getByRole('button', { name: 'Pause' }));
      act(() => vi.advanceTimersByTime(5000));
      expect(player.toggle).not.toHaveBeenCalled();
      expect(screen.getByTestId('tab-pill-bar')).toHaveTextContent('Bar 1 / 4');
    }
  });

  it('Off in the Count-in popover plays at once, and is remembered', async () => {
    await ready();
    fireEvent.click(screen.getByTestId('tab-tool-count'));
    fireEvent.click(within(screen.getByTestId('tab-popover-count')).getByRole('button', { name: 'Off' }));
    expect(screen.getByTestId('tab-tool-count')).toHaveTextContent('Off');
    expect(window.localStorage.getItem('ember.tabs.countIn')).toBe('0');
    fireEvent.click(within(screen.getByTestId('tab-pill')).getByRole('button', { name: 'Play' }));
    expect(player.toggle).toHaveBeenCalledTimes(1);
  });

  it('two bars, chosen before, count eight beats', async () => {
    window.localStorage.setItem('ember.tabs.countIn', '2');
    {
      await ready(true);
      expect(screen.getByTestId('tab-tool-count')).toHaveTextContent('2 bars');
      fireEvent.click(within(screen.getByTestId('tab-pill')).getByRole('button', { name: 'Play' }));
      act(() => vi.advanceTimersByTime(3000));
      expect(player.toggle).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1200));
      expect(player.toggle).toHaveBeenCalledTimes(1);
    }
  });

  it('pausing is never counted in', async () => {
    player.isPlaying = true;
    await ready();
    fireEvent.click(within(screen.getByTestId('tab-pill')).getByRole('button', { name: 'Pause' }));
    expect(player.toggle).toHaveBeenCalledTimes(1);
  });
});

describe('TabsPage practice tools on a phone', () => {
  beforeEach(() => {
    phone = true;
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
  });

  it('the pill’s sliders button shows the five cells above it, and the choice is remembered', async () => {
    const view = wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    expect(screen.queryByRole('toolbar', { name: 'Practice' })).toBeNull();
    const more = within(screen.getByTestId('tab-pill')).getByRole('button', { name: 'Practice tools' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    const bar = screen.getByRole('toolbar', { name: 'Practice' });
    expect(within(bar).getAllByRole('button')).toHaveLength(5);
    // At the bottom with the pill, not in the title line.
    expect(screen.getByTestId('tabs-sticky')).not.toContainElement(bar);
    expect(window.localStorage.getItem('ember.tabs.tools')).toBe('open');
    view.unmount();
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByRole('toolbar', { name: 'Practice' })).toBeInTheDocument();
  });

  it('the pill’s loop with no bars chosen opens the strip at the Loop popover', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    fireEvent.click(within(screen.getByTestId('tab-pill')).getByRole('button', { name: 'Loop the bars' }));
    expect(screen.getByRole('toolbar', { name: 'Practice' })).toBeInTheDocument();
    expect(screen.getByTestId('tab-popover-loop')).toBeInTheDocument();
  });

  it('a wide screen has no sliders button: the toolbar is always there', async () => {
    phone = false;
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    expect(within(screen.getByTestId('tab-pill')).queryByRole('button', { name: 'Practice tools' })).toBeNull();
  });
});

describe('TabsPage turned off', () => {
  it('shows the turned-off state instead of the score, with a link to Settings > Plugins', async () => {
    useSettingsStore.getState().setTabsEnabled(false);
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByText('Guitar tabs are turned off.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Settings/ });
    expect(link).toHaveAttribute('href', '/settings/plugins');
    expect(screen.queryByTestId('tab-score')).toBeNull();
  });
});

const MATCHES = [
  { id: 7, artist: 'Coastline', title: 'Copper Sky', hasChords: true, instruments: ['Guitar', 'Bass', 'Drums'], url: 'https://www.songsterr.com/a/7' },
  { id: 8, artist: 'Coastline', title: 'Copper Sky (Live at the Harbour Room)', hasChords: false, instruments: ['Guitar', 'Bass'], url: 'https://www.songsterr.com/a/8' },
  { id: 9, artist: 'Coastline', title: 'Copper Sky (Acoustic)', hasChords: true, instruments: ['Acoustic Guitar'], url: 'https://www.songsterr.com/a/9' },
];
const UG_URL = 'https://www.ultimate-guitar.com/search.php?search_type=title&value=Coastline+Copper+Sky';
const GP_URL = 'https://duckduckgo.com/?q=Coastline+Copper+Sky+(gp5+OR+gpx+OR+"guitar+pro")';
const SS_SEARCH = 'https://www.songsterr.com/?pattern=Coastline+Copper+Sky';

describe('TabsPage empty state: find one, then add it', () => {
  it('says Ember looked on Songsterr, then three sites, each with Find one opening it in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByText('Ember looked on Songsterr: nothing yet. Find one, then add it here.')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-empty')).toHaveAttribute('data-state', 'none');
    // The header stays the full one: Guitar tab over the title.
    expect(screen.getByRole('heading', { name: 'Copper Sky' })).toBeInTheDocument();
    expect(screen.getByText('Guitar tab')).toBeInTheDocument();
    const sites = screen.getAllByTestId('tabs-empty-site');
    expect(sites.map((a) => a.getAttribute('data-link'))).toEqual(['songsterr', 'ultimate-guitar', 'guitar-pro']);
    expect(sites[1]).toHaveTextContent('Ultimate Guitar');
    expect(sites[1]).toHaveTextContent('Text and Guitar Pro tabs, rated by players');
    expect(sites[2]).toHaveTextContent('A web search for .gp and .gpx files');
    const find = (i: number) => within(sites[i]).getByRole('link', { name: /^Find one on/ });
    expect(find(0)).toHaveAttribute('href', SS_SEARCH);
    expect(find(1)).toHaveAttribute('href', UG_URL);
    expect(find(2)).toHaveAttribute('href', GP_URL);
    for (const i of [0, 1, 2]) {
      expect(find(i)).toHaveAttribute('target', '_blank');
      expect(find(i)).toHaveAttribute('rel', 'noopener noreferrer');
      expect(find(i)).toHaveTextContent('Find one');
    }
    fireEvent.click(find(2));
    expect(open).toHaveBeenLastCalledWith(GP_URL, '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('back from a site: a card waits at the top to add the file, and that site says Again', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    api.uploadTabFile.mockResolvedValue({ tab: tab({}) });
    wrap(<TabsPage trackId="upload:song1" />);
    const ug = (await screen.findAllByTestId('tabs-empty-site'))[1];
    expect(screen.queryByTestId('tabs-return')).toBeNull();
    fireEvent.click(within(ug).getByRole('link', { name: 'Find one on Ultimate Guitar' }));
    const back = screen.getByTestId('tabs-return');
    expect(back).toHaveTextContent('Back from Ultimate Guitar? Add what you found.');
    expect(within(ug).getByRole('link')).toHaveTextContent('Again');
    // The quiet Add a file line under the sites gives way to the card.
    expect(screen.queryByRole('button', { name: 'Add a file' })).toBeNull();
    const input = screen.getByLabelText('Tab file') as HTMLInputElement;
    const pick = vi.spyOn(input, 'click');
    fireEvent.click(within(back).getByRole('button', { name: 'Add the file' }));
    expect(pick).toHaveBeenCalled();
    const file = new File(['x'], 'copper.gp5');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(api.uploadTabFile).toHaveBeenCalledWith(file, { title: 'Copper Sky', artist: 'Coastline', trackId: 'upload:song1' }),
    );
    open.mockRestore();
  });

  it('or paste the text tab: read as it is typed, then added for the song', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    api.addTabText.mockResolvedValue({ tab: tab({ id: 'p1', kind: 'pasted' }) });
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(within((await screen.findAllByTestId('tabs-empty-site'))[0]).getByRole('link'));
    const back = screen.getByTestId('tabs-return');
    expect(back).toHaveTextContent('Back from Songsterr?');
    fireEvent.click(within(back).getByRole('button', { name: 'Paste a text tab' }));
    const add = within(back).getByRole('button', { name: 'Add this tab' });
    expect(add).toBeDisabled();
    fireEvent.change(within(back).getByLabelText('Text tab'), { target: { value: 'hello there' } });
    expect(add).toBeDisabled();
    expect(screen.getByTestId('tabs-paste-check').textContent).not.toBe('');
    const text = ['e|---0---3---|', 'B|---1---0---|', 'G|---0---0---|', 'D|---2---0---|', 'A|---3---2---|', 'E|-------3---|'].join('\n');
    fireEvent.change(within(back).getByLabelText('Text tab'), { target: { value: text } });
    expect(screen.getByTestId('tabs-paste-check')).toHaveTextContent(/^Looks like a tab: 6 strings, Standard/);
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.addTabText).toHaveBeenCalledWith(text, { title: 'Copper Sky', artist: 'Coastline', trackId: 'upload:song1' }),
    );
    open.mockRestore();
  });

  it('a paste the server turns down says why', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    api.addTabText.mockRejectedValue(new Error('No tab lines found'));
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(within((await screen.findAllByTestId('tabs-empty-site'))[0]).getByRole('link'));
    const back = screen.getByTestId('tabs-return');
    fireEvent.click(within(back).getByRole('button', { name: 'Paste a text tab' }));
    fireEvent.change(within(back).getByLabelText('Text tab'), {
      target: { value: ['e|---0---3---|', 'B|---1---0---|', 'G|---0---0---|', 'D|---2---0---|', 'A|---3---2---|', 'E|-------3---|'].join('\n') },
    });
    fireEvent.click(within(back).getByRole('button', { name: 'Add this tab' }));
    expect(await within(back).findByRole('alert')).toHaveTextContent('No tab lines found');
    open.mockRestore();
  });

  it('Look again asks anew, saying it looks while it does', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByText(/Ember looked on Songsterr/);
    await waitFor(() => expect(api.findTabsOnline).toHaveBeenCalledTimes(1));
    let finish: (v: unknown) => void = () => {};
    api.findTabsOnline.mockReturnValue(new Promise((r) => (finish = r)));
    fireEvent.click(screen.getByRole('button', { name: 'Look again' }));
    expect(await screen.findByTestId('tabs-searching')).toHaveTextContent('Looking on Songsterr…');
    expect(screen.getByRole('button', { name: 'Look again' })).toBeDisabled();
    expect(api.findTabsOnline).toHaveBeenLastCalledWith('upload:song1', 'Copper Sky', 'Coastline', true);
    await act(async () => finish({ status: 'none', searchedAt: 'now', added: 0 }));
    expect(await screen.findByText(/Ember looked on Songsterr/)).toBeInTheDocument();
  });

  it('a song Songsterr has but Ember could not draw: said so, and Find one opens its best version', async () => {
    api.getTabs.mockResolvedValue({ matches: MATCHES });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByText('Songsterr has 3 tabs Ember could not draw here. Find one there, then add it here.')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-empty')).toHaveAttribute('data-state', 'matches');
    const ss = screen.getAllByTestId('tabs-empty-site')[0];
    expect(ss).toHaveTextContent('3 versions there');
    expect(within(ss).getByRole('link')).toHaveAttribute('href', 'https://www.songsterr.com/a/7');
  });

  it('one version: said in the singular', async () => {
    api.getTabs.mockResolvedValue({ matches: [MATCHES[0]] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByText('Songsterr has 1 tab Ember could not draw here. Find it there, then add it here.')).toBeInTheDocument();
    expect(screen.getAllByTestId('tabs-empty-site')[0]).toHaveTextContent('1 version there');
  });

  it('in the desktop app Find one opens in the system browser', async () => {
    const invoke = vi.fn(async () => null);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      wrap(<TabsPage trackId="upload:song1" />);
      fireEvent.click(within((await screen.findAllByTestId('tabs-empty-site'))[1]).getByRole('link'));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('open_external', { url: UG_URL }));
      expect(open).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      open.mockRestore();
    }
  });

  it('an upload that is not playing and has no tab yet is named from the uploads, and offers Add a file', async () => {
    player.current = { ...SONG, id: 'upload:other' };
    api.listUploads.mockResolvedValue({ tracks: [SONG] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByRole('heading', { name: 'Copper Sky' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add a file' })).toBeInTheDocument();
  });

  it('a song Ember cannot name at all says so', async () => {
    player.current = null;
    wrap(<TabsPage trackId="upload:gone" />);
    expect(await screen.findByText('Ember does not know that song.')).toBeInTheDocument();
  });
});

describe('TabsPage empty state: still looking', () => {
  it('while Songsterr has not answered: Looking on Songsterr, the sites and Add a file already there', async () => {
    api.getTabs.mockReturnValue(new Promise(() => {}));
    wrap(<TabsPage trackId="upload:song1" />);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Looking on Songsterr…');
    expect(screen.getByTestId('tabs-empty')).toHaveAttribute('data-state', 'searching');
    expect(screen.getAllByTestId('tabs-empty-site')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Add a file' })).toBeEnabled();
  });

  it('then says what it found once Songsterr answers', async () => {
    let answer: (v: unknown) => void = () => {};
    api.getTabs.mockReturnValue(new Promise((r) => (answer = r)));
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByText('Looking on Songsterr…')).toBeInTheDocument();
    await act(async () => answer({ matches: MATCHES.slice(0, 2) }));
    expect(await screen.findByText(/Songsterr has 2 tabs/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('TabsPage empty state: Add a file', () => {
  it('opens the file picker and uploads the file for this song', async () => {
    api.uploadTabFile.mockResolvedValue({ tab: tab({}) });
    wrap(<TabsPage trackId="upload:song1" />);
    const input = screen.getByLabelText('Tab file') as HTMLInputElement;
    const pick = vi.spyOn(input, 'click');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a file' }));
    expect(pick).toHaveBeenCalled();
    expect(input).toHaveAttribute('accept', '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl');
    expect(screen.getByText('A Guitar Pro or MusicXML tab. Everyone here gets it.')).toBeInTheDocument();
    const file = new File(['x'], 'copper.gp5');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(api.uploadTabFile).toHaveBeenCalledWith(file, { title: 'Copper Sky', artist: 'Coastline', trackId: 'upload:song1' }),
    );
  });

  it('says Adding while the upload runs, and the error if it fails', async () => {
    let fail: (e: Error) => void = () => {};
    api.uploadTabFile.mockReturnValue(new Promise((_r, j) => (fail = j)));
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByRole('button', { name: 'Add a file' });
    fireEvent.change(screen.getByLabelText('Tab file'), { target: { files: [new File(['x'], 'a.gp5')] } });
    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeDisabled();
    await act(async () => fail(new Error('That doesn’t look like a Guitar Pro file')));
    expect(await screen.findByText('That doesn’t look like a Guitar Pro file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a file' })).toBeEnabled();
  });
});

describe('TabsPage without tab generation', () => {
  it('offers no Generate anywhere: not in the empty state, the ⋯ menu or the Source sheet', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByText(/Ember looked on Songsterr/);
    expect(screen.queryByText(/Generat|Transcrib|rough/i)).toBeNull();
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Add a Guitar Pro or MusicXML file',
      'Search online again',
      'Search Ultimate Guitar',
      'Search Guitar Pro files',
      'Open on Songsterr',
    ]);
  });

  it('the menu is the same with a tab drawn, minus nothing but Generate', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    expect(screen.queryByText(/Generat|Transcrib/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a tab' }));
    expect(within(screen.getByTestId('tab-source-sheet')).queryByText(/Generat/i)).toBeNull();
    expect(within(screen.getByTestId('tab-source-sheet')).getByRole('button', { name: 'Add a file' })).toBeInTheDocument();
  });
});

describe('TabsPage search links', () => {
  it('the menu opens each search with noopener, Songsterr on its match', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
    api.getTabs.mockResolvedValue({
      matches: [{ id: 7, artist: 'Coastline', title: 'Copper Sky', hasChords: false, instruments: ['Guitar'], url: 'https://www.songsterr.com/a/7' }],
    });
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Search Ultimate Guitar' }));
    expect(open).toHaveBeenLastCalledWith(
      'https://www.ultimate-guitar.com/search.php?search_type=title&value=Coastline+Copper+Sky',
      '_blank',
      'noopener,noreferrer',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Search Guitar Pro files' }));
    expect(open.mock.lastCall?.[0]).toContain('https://duckduckgo.com/?q=Coastline+Copper+Sky+');
    await waitFor(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Open on Songsterr' }));
      expect(open).toHaveBeenLastCalledWith('https://www.songsterr.com/a/7', '_blank', 'noopener,noreferrer');
    });
    open.mockRestore();
  });
});

describe('TabsPage toolbar and layout', () => {
  beforeEach(() => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
  });

  it('the ⋯ menu shows the score too and scrolls sideways, and both are remembered', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    const s = await screen.findByTestId('tab-score');
    expect(s).toHaveAttribute('data-scroll', 'vertical');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scroll sideways' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show the score too' }));
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-scroll', 'horizontal');
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-staff', 'score-tab');
    expect(window.localStorage.getItem('ember.tabs.scroll')).toBe('horizontal');
    expect(window.localStorage.getItem('ember.tabs.staff')).toBe('score-tab');
    // The items now say the way back.
    expect(screen.getByRole('menuitem', { name: 'Scroll down the page' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Show the tab only' })).toBeInTheDocument();
  });

  // The desktop top bar is sticky in the same page scroller
  // (components/nav/DesktopTopBar), so the toolbar sticks just under it and
  // the score's follow-scroll keeps the playing bar clear of both.
  it('sticks the toolbar under the top bar, and counts the bar in the score top inset', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    const sticky = screen.getByTestId('tabs-sticky');
    expect(sticky.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(sticky.className).toContain('top-(--ember-topbar-h,0px)');
    const rect = vi.spyOn(sticky, 'getBoundingClientRect').mockReturnValue({ height: 50 } as DOMRect);
    // No bar (a phone): the toolbar alone.
    expect(score.last!.getTopInset!()).toBe(50);
    // The layout publishes the bar's height; happy-dom does not inherit
    // custom properties, so set it where the page reads it.
    sticky.style.setProperty('--ember-topbar-h', '80px');
    expect(score.last!.getTopInset!()).toBe(130);
    rect.mockRestore();
  });

  it('one thin title line: the title, then artist, part and speed; the whole meta line in its tooltip', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    act(() =>
      score.last!.onScore!({
        tempo: 96,
        signature: null,
        key: 'D minor',
        tracks: [
          { index: 0, name: 'Guitar', instrument: 'Distortion guitar', tuning: 'Drop D', strings: 'D A D G B E', tab: true },
          { index: 1, name: 'Bass', instrument: 'Bass', tuning: 'Drop D', strings: 'D A D G', tab: true },
        ],
      }),
    );
    const meta = screen.getByTestId('tab-stage-meta');
    expect(meta).toHaveTextContent('Coastline · Guitar · 100%');
    expect(meta).toHaveAttribute('title', 'Coastline · 96 bpm · D minor · Distortion guitar, Drop D (D A D G B E)');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show the Bass part' }));
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-track', '1');
    expect(screen.getByTestId('tab-stage-meta')).toHaveTextContent('Coastline · Bass · 100%');
  });

  it('the title line dims while the song plays, and not while it is paused', async () => {
    const view = wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    expect(screen.getByTestId('tab-stage-header')).toHaveAttribute('data-dim', 'true');
    player.isPlaying = false;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TabsPage trackId="upload:song1" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('tab-stage-header')).not.toHaveAttribute('data-dim'));
  });

  it('phone width: smaller score, the same pill', async () => {
    phone = true;
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-scale', '0.65');
    expect(screen.getByTestId('tab-pill')).toBeInTheDocument();
  });
});

describe('TabsPage pill', () => {
  /** Eight bars of 4/4 at 120: two seconds each. */
  const timeline = () =>
    buildTimeline(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        start: i * 3840,
        end: (i + 1) * 3840,
        tempoChanges: [{ tick: i * 3840, tempo: 120 }],
        masterBar: { index: i, timeSignatureNumerator: 4, timeSignatureDenominator: 4 },
      })),
    );

  beforeEach(() => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
  });

  it('plays and pauses the song through the player', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    const pill = screen.getByTestId('tab-pill');
    fireEvent.click(within(pill).getByRole('button', { name: 'Pause' }));
    expect(player.toggle).toHaveBeenCalledTimes(1);
    expect(player.playTrack).not.toHaveBeenCalled();
  });

  it('a song that is not playing: Play starts it', async () => {
    player.current = { ...SONG, id: 'upload:other' };
    // Known from the uploads, so it can be played.
    api.listUploads.mockResolvedValue({ tracks: [SONG] });
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    const play = within(screen.getByTestId('tab-pill')).getByRole('button', { name: 'Play' });
    await waitFor(() => expect(play).toBeEnabled());
    fireEvent.click(play);
    expect(player.playTrack).toHaveBeenCalledWith(SONG);
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it('says the bar the song is in, of all of them', async () => {
    player.position = 5;
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    expect(screen.getByTestId('tab-pill-bar')).toHaveTextContent('Bar …');
    act(() => score.last!.onTimeline!(timeline()));
    // 5 s is in bar 3.
    expect(screen.getByTestId('tab-pill-bar')).toHaveTextContent('Bar 3 / 8');
  });

  it('a tap on the speed is one step slower, and from the slowest back to full speed', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    const speed = () => within(screen.getByTestId('tab-pill')).getByRole('button', { name: /^Speed/ });
    expect(speed()).toHaveTextContent('100%');
    fireEvent.click(speed());
    expect(player.setRate).toHaveBeenLastCalledWith(0.9);
    expect(speed()).toHaveTextContent('90%');
    expect(screen.getByTestId('tab-stage-meta')).toHaveTextContent('90%');
    for (let i = 0; i < 6; i++) fireEvent.click(speed());
    expect(speed()).toHaveTextContent('100%');
  });

  it('the speed is off where the player cannot change it', async () => {
    player.canSetRate = false;
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    expect(within(screen.getByTestId('tab-pill')).getByRole('button', { name: /^Speed/ })).toBeDisabled();
  });

  it('the loop: with no bars chosen it opens the loop controls; with bars, it turns the loop on and off', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    act(() => score.last!.onTimeline!(timeline()));
    const loop = () => within(screen.getByTestId('tab-pill')).getByRole('button', { name: 'Loop the bars' });
    fireEvent.click(loop());
    const row = screen.getByTestId('tab-popover-loop');
    fireEvent.change(within(row).getByLabelText('Loop from bar'), { target: { value: '3' } });
    fireEvent.change(within(row).getByLabelText('Loop to bar'), { target: { value: '4' } });
    expect(loop()).toHaveAttribute('aria-pressed', 'true');
    expect(loop()).toHaveTextContent('Bars 3–4');
    fireEvent.click(loop());
    expect(loop()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-highlight', '');
    fireEvent.click(loop());
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-highlight', '2-3');
  });
});

describe('TabsPage and the player', () => {
  beforeEach(() => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({})] });
  });

  it('follows the playing song, and seeks through the player', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-follows', 'true');
    score.last!.onSeek(42);
    expect(player.seek).toHaveBeenCalledWith(42);
  });

  it('a song that is not playing: the score stays still and offers to play it', async () => {
    player.current = { ...SONG, id: 'upload:other' };
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({ title: 'Copper Sky', artist: 'Coastline' })] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-follows', 'false');
    expect(screen.getByText(/This song is not playing/)).toBeInTheDocument();
  });

  it('moves to the next song’s tab when the player moves on', async () => {
    const view = wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    player.current = { ...SONG, id: 'upload:song2' };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TabsPage trackId="upload:song1" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/tabs/upload%3Asong2'));
  });

  it('keeps following when the player skips twice before the first move lands', async () => {
    const view = wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    const at = (page: string) =>
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <TabsPage trackId={page} />
        </QueryClientProvider>,
      );
    player.current = { ...SONG, id: 'upload:song2' };
    at('upload:song1');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/tabs/upload%3Asong2'));
    // Skipped again while the page is still on song 1's address.
    player.current = { ...SONG, id: 'upload:song3' };
    at('upload:song1');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/tabs/upload%3Asong3'));
    // The two moves land in turn; the page ends up following song 3.
    at('upload:song2');
    at('upload:song3');
    player.current = { ...SONG, id: 'upload:song4' };
    at('upload:song3');
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith('/tabs/upload%3Asong4'));
  });

  it('Back goes back', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(router.back.mock.calls.length + router.push.mock.calls.length).toBe(1);
  });
});

describe('TabsPage looking online', () => {
  const fetched = tab({
    id: 'u1',
    kind: 'fetched',
    addedBy: null,
    instrument: 'Guitar',
    downloadUrl: '/api/tabs/files/u1/download',
    source: {
      site: 'ug',
      siteLabel: 'Ultimate Guitar',
      url: 'https://tabs.ultimate-guitar.com/tab/c/copper-sky-tabs-1',
      part: 'guitar',
      version: 1,
      rating: 4.7,
      votes: 512,
    },
  });

  it('asks once when the page opens, after the store answered', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await waitFor(() => expect(api.findTabsOnline).toHaveBeenCalledWith('upload:song1', 'Copper Sky', 'Coastline'));
    expect(api.findTabsOnline).toHaveBeenCalledTimes(1);
  });

  it('shows Looking on Songsterr while it looks, then draws what it found', async () => {
    let finish: (v: unknown) => void = () => {};
    api.findTabsOnline.mockReturnValue(new Promise((r) => (finish = r)));
    api.getTrackTabs.mockResolvedValueOnce({ tabs: [] }).mockResolvedValue({ tabs: [fetched] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tabs-searching')).toHaveTextContent('Looking on Songsterr…');
    finish({ status: 'found', searchedAt: 'now', added: 1 });
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-url', '/api/tabs/files/u1/download');
    expect(screen.getByTestId('tab-source-chip')).toHaveTextContent('From Ultimate Guitar, not lined up yet');
  });

  it('the Source sheet lists every tab with its type and rating, and a pick is remembered', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({}), fetched] });
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    fireEvent.click(screen.getByRole('button', { name: 'Choose a tab' }));
    const rows = screen.getAllByTestId('tab-source-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Guitar Pro file');
    expect(rows[1]).toHaveTextContent('Text tab');
    expect(rows[1]).toHaveTextContent('★ 4.7 (512 votes)');
    fireEvent.click(within(rows[1]).getByRole('radio'));
    await waitFor(() => expect(screen.getByTestId('tab-score')).toHaveAttribute('data-url', '/api/tabs/files/u1/download'));
    expect(window.localStorage.getItem('ember.tab.pick.upload:song1')).toBe('u1');
    expect(screen.queryByTestId('tab-source-sheet')).toBeNull();
  });

  it('a pick made before is the tab the page opens on', async () => {
    window.localStorage.setItem('ember.tab.pick.upload:song1', 'u1');
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({}), fetched] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-url', '/api/tabs/files/u1/download');
  });

  it('Search online again asks the server anew, and says when nothing new came', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [fetched] });
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    await waitFor(() => expect(api.findTabsOnline).toHaveBeenCalledTimes(1));
    api.findTabsOnline.mockResolvedValue({ status: 'found', searchedAt: 'now', added: 0 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Search online again' }));
    await waitFor(() => expect(api.findTabsOnline).toHaveBeenLastCalledWith('upload:song1', 'Copper Sky', 'Coastline', true));
    expect(await screen.findByTestId('tabs-online-status')).toHaveTextContent('Nothing new found online.');
  });

  it('a failed search is quiet: the empty state stays as it was', async () => {
    api.findTabsOnline.mockRejectedValue(new Error('boom'));
    wrap(<TabsPage trackId="upload:song1" />);
    await waitFor(() => expect(screen.getByTestId('tabs-empty')).toHaveAttribute('data-state', 'none'));
    expect(screen.queryByTestId('tabs-searching')).toBeNull();
  });
});
