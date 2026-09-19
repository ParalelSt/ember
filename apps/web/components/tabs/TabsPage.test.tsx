import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TabSummary } from '@/lib/tabSources';
import type { Track } from '@/types/track';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { LiveTabScoreProps } from './LiveTabScore';
import { TabsPage } from './TabsPage';

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
}));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));

const api = vi.hoisted(() => ({
  getTrackTabs: vi.fn(),
  getGeneratedTab: vi.fn(),
  getTabs: vi.fn(),
  generateTab: vi.fn(),
  uploadTabFile: vi.fn(),
  deleteTabFile: vi.fn(),
  saveTabOffset: vi.fn(),
  getTrack: vi.fn(),
  listUploads: vi.fn(),
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
  score.last = null;
  api.getTrackTabs.mockResolvedValue({ tabs: [] });
  api.getGeneratedTab.mockResolvedValue({ status: 'none' });
  api.getTabs.mockResolvedValue({ matches: [] });
  api.generateTab.mockResolvedValue({ status: 'running' });
  api.listUploads.mockResolvedValue({ tracks: [] });
});

describe('TabsPage source selection', () => {
  it('a file someone added beats the generated tab, with its chip', async () => {
    api.getTrackTabs.mockResolvedValue({
      tabs: [tab({ id: 'g1', kind: 'generated', downloadUrl: '/api/tabs/generated/upload%3Asong1' }), tab({})],
    });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-url', '/api/tabs/files/f1/download');
    expect(screen.getByTestId('tab-source-chip')).toHaveTextContent('File added by Mira, shared');
    expect(screen.getByRole('heading', { name: 'Copper Sky' })).toBeInTheDocument();
    expect(screen.getByText('Guitar tab')).toBeInTheDocument();
    // Two tabs for the song: the chip is a menu to switch.
    expect(screen.getByRole('button', { name: 'Choose a tab' })).toBeInTheDocument();
  });

  it('asks for the whole chain of the playing track', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await waitFor(() => expect(api.getTrackTabs).toHaveBeenCalledWith('upload:song1', 'Copper Sky', 'Coastline'));
  });

  it('a generated tab alone shows as generated', async () => {
    api.getTrackTabs.mockResolvedValue({ tabs: [tab({ id: 'g1', kind: 'generated', addedBy: null })] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-source-chip')).toHaveTextContent('Generated from the recording');
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
    fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
    fireEvent.change(screen.getByLabelText('Tab timing offset in seconds'), { target: { value: '2.5' } });
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-offset', '2500');
    expect(window.localStorage.getItem('ember.tab.offset.f1')).toBe('2.5');
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

describe('TabsPage empty states', () => {
  it('no tab: offers Generate a tab and Add a file', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    const generate = await screen.findByRole('button', { name: 'Generate a tab (rough)' });
    expect(screen.getByRole('button', { name: 'Add a file' })).toBeInTheDocument();
    expect(screen.queryByTestId('tab-score')).toBeNull();
    fireEvent.click(generate);
    await waitFor(() => expect(api.generateTab).toHaveBeenCalledWith('upload:song1', 'Copper Sky', 'Coastline'));
    expect(await screen.findByText(/Transcribing the recording/)).toBeInTheDocument();
  });

  it('an upload that is not playing and has no tab yet is named from the uploads, and offers to generate', async () => {
    player.current = { ...SONG, id: 'upload:other' };
    api.listUploads.mockResolvedValue({ tracks: [SONG] });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByRole('heading', { name: 'Copper Sky' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Generate a tab (rough)' })).toBeInTheDocument();
  });

  it('a song Ember cannot name at all says so', async () => {
    player.current = null;
    wrap(<TabsPage trackId="upload:gone" />);
    expect(await screen.findByText('Ember does not know that song.')).toBeInTheDocument();
  });

  it('a running job shows the transcribing state', async () => {
    api.getGeneratedTab.mockResolvedValue({ status: 'running' });
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByText(/Transcribing the recording/)).toBeInTheDocument();
  });

  it('Songsterr only: the link out, and no generate for a song Ember cannot transcribe', async () => {
    player.current = { ...SONG, id: 'jamendo:9', source: 'jamendo' };
    api.getTabs.mockResolvedValue({
      matches: [{ id: 7, artist: 'Coastline', title: 'Copper Sky', hasChords: false, instruments: ['Guitar'], url: 'https://www.songsterr.com/a/7' }],
    });
    wrap(<TabsPage trackId="jamendo:9" />);
    const link = await screen.findByRole('link', { name: /Copper Sky/ });
    expect(link).toHaveAttribute('href', 'https://www.songsterr.com/a/7');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('button', { name: 'Generate a tab (rough)' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a file' })).toBeInTheDocument();
  });
});

describe('TabsPage search links', () => {
  it('the empty state links out to Ultimate Guitar, Guitar Pro files and Songsterr search, in a new tab', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    const ug = await screen.findByRole('link', { name: 'Ultimate Guitar' });
    expect(ug).toHaveAttribute('href', 'https://www.ultimate-guitar.com/search.php?search_type=title&value=Coastline+Copper+Sky');
    expect(ug).toHaveAttribute('target', '_blank');
    expect(ug).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Guitar Pro files' })).toHaveAttribute(
      'href',
      'https://duckduckgo.com/?q=Coastline+Copper+Sky+(gp5+OR+gpx+OR+"guitar+pro")',
    );
    expect(screen.getByRole('link', { name: 'Songsterr' })).toHaveAttribute(
      'href',
      'https://www.songsterr.com/?pattern=Coastline+Copper+Sky',
    );
  });

  it('generating comes after adding a file, marked rough', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    const generate = await screen.findByRole('button', { name: 'Generate a tab (rough)' });
    const add = screen.getByRole('button', { name: 'Add a file' });
    expect(add.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

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

  it('Horizontal and Tab + Score reach the score and are remembered', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    const s = await screen.findByTestId('tab-score');
    expect(s).toHaveAttribute('data-scroll', 'vertical');
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tab + Score' }));
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-scroll', 'horizontal');
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-staff', 'score-tab');
    expect(window.localStorage.getItem('ember.tabs.scroll')).toBe('horizontal');
    expect(window.localStorage.getItem('ember.tabs.staff')).toBe('score-tab');
  });

  it('shows the instruments the score reports, and switches between them', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    const { act } = await import('@testing-library/react');
    act(() =>
      score.last!.onScore!({
        tempo: 96,
        key: 'D minor',
        tracks: [
          { index: 0, name: 'Guitar', instrument: 'Distortion guitar', tuning: 'Drop D', strings: 'D A D G B E' },
          { index: 1, name: 'Bass', instrument: 'Bass', tuning: 'Drop D', strings: 'D A D G' },
        ],
      }),
    );
    expect(screen.getByText('Coastline · 96 bpm · D minor · Distortion guitar, Drop D (D A D G B E)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bass/ }));
    expect(screen.getByTestId('tab-score')).toHaveAttribute('data-track', '1');
    expect(screen.getByText('Coastline · 96 bpm · D minor · Bass, Drop D (D A D G)')).toBeInTheDocument();
  });

  it('phone width: smaller score and the short labels', async () => {
    phone = true;
    wrap(<TabsPage trackId="upload:song1" />);
    expect(await screen.findByTestId('tab-score')).toHaveAttribute('data-scale', '0.65');
    expect(screen.getByRole('button', { name: '+ Score' })).toBeInTheDocument();
  });

  it('has no transport of its own: the player bar stays for that', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    await screen.findByTestId('tab-score');
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Loop' })).toBeNull();
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

  it('Back goes back', async () => {
    wrap(<TabsPage trackId="upload:song1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(router.back.mock.calls.length + router.push.mock.calls.length).toBe(1);
  });
});
