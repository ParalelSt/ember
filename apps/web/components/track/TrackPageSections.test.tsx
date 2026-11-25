import type { ComponentProps, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { AlbumDetail, ArtistPayload, Track } from '@/types/track';
import type { SongLyrics as LyricsResult } from './SongLyricsSheet';

type Q<T> = { data?: T; isLoading?: boolean; error?: unknown };

const state = vi.hoisted(() => ({
  lyrics: {} as Q<LyricsResult>,
  artist: {} as Q<ArtistPayload>,
  album: {} as Q<AlbumDetail>,
  recommended: {} as Q<Track[]>,
  calls: { artist: [] as string[], album: [] as unknown[], recommended: [] as unknown[], lyrics: [] as unknown[] },
  onPlay: vi.fn(),
  desktop: false,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
// The sheet's own chrome (portal, focus trap) is not what is tested here.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid={rest['data-testid'] as string} data-side={rest.side as string}>{children}</div>
  ),
  SheetTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  SheetDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/hooks/useLyrics', () => ({
  useQueryLyrics: (track: Track | null, enabled: boolean) => {
    state.calls.lyrics.push([track?.id, enabled]);
    return state.lyrics;
  },
}));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryArtist: (id: string) => {
    state.calls.artist.push(id);
    return state.artist;
  },
  useQueryAlbum: (id: string | null | undefined) => {
    state.calls.album.push(id);
    return state.album;
  },
  useQueryRecommended: (seed: string | undefined) => {
    state.calls.recommended.push(seed);
    return state.recommended;
  },
}));
vi.mock('@/components/track/menus/TrackMenu', () => ({
  renderTrackMenu: (t: Track) => <button type="button" aria-label={`More for ${t.title}`} />,
}));
vi.mock('@/hooks/useTrackActions', () => ({
  useTrackActions: () => ({
    currentId: null,
    isPlaying: false,
    likedIds: new Set<string>(),
    onPlay: state.onPlay,
    onToggle: vi.fn(),
    onLike: vi.fn(),
    isUnavailable: () => false,
    artworkSrcFor: () => null,
  }),
}));

const { TrackPageSections, similarTo, otherReleases, albumStat } = await import('./TrackPageSections');

function song(n: string, over: Partial<Track> = {}): Track {
  return {
    id: `youtube:${n}`,
    source: 'youtube',
    sourceId: n,
    title: `Song ${n}`,
    artist: `Artist ${n}`,
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: `/stream/${n}`,
    ...over,
  };
}

const TRACK = song('a1', {
  title: 'Midnight Drive',
  artist: 'The Nulls',
  artistId: 'UCnulls',
  album: 'Night Shift',
  albumId: 'MPREb_night',
  artworkUrl: 'https://img.test/a.jpg',
});

const LYRICS: LyricsResult = {
  lyrics: '[Verse 1]\nHeadlights on the water\nCity fading out\n\nNo one on the radio\nJust the engine sound\nAnd the road',
  source: 'genius',
  url: 'https://genius.test/midnight-drive',
};

const ARTIST: ArtistPayload = {
  name: 'The Nulls',
  description: null,
  thumbnails: [{ url: 'https://img.test/artist-small.jpg' }, { url: 'https://img.test/artist.jpg' }],
  tracks: [],
  albums: [
    { browseId: 'MPREb_night', title: 'Night Shift', year: 2024, thumbnails: [] },
    { browseId: 'MPREb_day', title: 'Day Job', year: 2021, thumbnails: [] },
  ],
  singles: [{ browseId: 'MPREb_single', title: 'Overtime', year: 2023, thumbnails: [] }],
};

const ALBUM: AlbumDetail = {
  title: 'Night Shift',
  artist: 'The Nulls',
  artistId: 'UCnulls',
  year: 2024,
  thumbnails: [{ url: 'https://img.test/album.jpg' }],
  trackCount: 11,
  totalDurationSec: 2400,
  tracks: [],
};

const RECS = Array.from({ length: 14 }, (_, i) => song(`r${i}`));

beforeEach(() => {
  vi.clearAllMocks();
  state.desktop = false;
  state.lyrics = { data: LYRICS };
  state.artist = { data: ARTIST };
  state.album = { data: ALBUM };
  state.recommended = { data: [TRACK, ...RECS] };
  state.calls = { artist: [], album: [], recommended: [], lyrics: [] };
});

const sectionNamed = (name: string) => screen.queryByRole('region', { name });

describe('Song page sections', () => {
  it('asks for this song\'s lyrics, artist, album and radio picks', () => {
    render(<TrackPageSections track={TRACK} />);
    expect(state.calls.lyrics).toContainEqual(['youtube:a1', true]);
    expect(state.calls.artist).toContain('UCnulls');
    expect(state.calls.album).toContain('MPREb_night');
    expect(state.calls.recommended).toContain('a1');
  });

  it('runs top to bottom: Lyrics, artist and album, More by, Similar songs', () => {
    render(<TrackPageSections track={TRACK} />);
    const order = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(order).toEqual(['Lyrics', 'Artist and album', 'More by The Nulls', 'Similar songs']);
  });
});

describe('Lyrics', () => {
  it('previews exactly the first 3 sung lines, the first brighter, then the tap hint', () => {
    render(<TrackPageSections track={TRACK} />);
    const section = sectionNamed('Lyrics')!;
    expect(within(section).getByRole('heading', { name: 'Lyrics' })).toBeInTheDocument();
    const lines = within(section).getAllByTestId('lyrics-preview-line');
    expect(lines.map((l) => l.textContent)).toEqual(['Headlights on the water', 'City fading out', 'No one on the radio']);
    expect(lines[0].className).toContain('font-semibold');
    expect(lines[0].className).toContain('text-foreground');
    expect(lines[1].className).toContain('text-muted-foreground');
    expect(lines[2].className).toContain('text-muted-foreground');
    expect(within(section).getByText('Tap for the whole song')).toBeInTheDocument();
    expect(within(section).queryByText('Just the engine sound')).toBeNull();
  });

  it('uses the synced lines when there are some', () => {
    state.lyrics = {
      data: {
        lyrics: null,
        source: 'lrclib',
        url: null,
        synced: [
          { time: 0, text: '' },
          { time: 1, text: 'One' },
          { time: 2, text: 'Two' },
          { time: 3, text: 'Three' },
          { time: 4, text: 'Four' },
        ],
      },
    };
    render(<TrackPageSections track={TRACK} />);
    expect(screen.getAllByTestId('lyrics-preview-line').map((l) => l.textContent)).toEqual(['One', 'Two', 'Three']);
  });

  it('tapping the card opens the whole lyrics of this song', async () => {
    render(<TrackPageSections track={TRACK} />);
    expect(screen.queryByTestId('song-lyrics-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('lyrics-preview'));
    const sheet = await screen.findByTestId('song-lyrics-sheet');
    expect(within(sheet).getByText('Midnight Drive · The Nulls')).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Just the engine sound');
    expect(sheet).toHaveTextContent('And the road');
    expect(within(sheet).getByRole('link', { name: 'Source: Genius' })).toHaveAttribute('href', LYRICS.url);
  });

  it('the whole lyrics come up from the bottom on a phone, from the right on desktop', async () => {
    const { unmount } = render(<TrackPageSections track={TRACK} />);
    fireEvent.click(screen.getByTestId('lyrics-preview'));
    expect(await screen.findByTestId('song-lyrics-sheet')).toHaveAttribute('data-side', 'bottom');
    unmount();
    state.desktop = true;
    render(<TrackPageSections track={TRACK} />);
    fireEvent.click(screen.getByTestId('lyrics-preview'));
    expect(await screen.findByTestId('song-lyrics-sheet')).toHaveAttribute('data-side', 'right');
  });

  it('Open opens the same whole lyrics', async () => {
    render(<TrackPageSections track={TRACK} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open lyrics' }));
    const sheet = await screen.findByTestId('song-lyrics-sheet');
    expect(sheet).toHaveTextContent('Headlights on the water');
    expect(sheet).toHaveTextContent('And the road');
  });

  it('hides while loading, on an error, and for a song with no lyrics', () => {
    for (const q of [
      { data: undefined, isLoading: true },
      { data: undefined, error: new Error('Lyrics unavailable for now') },
      { data: { lyrics: null, source: 'none', url: null } as LyricsResult },
      { data: { lyrics: '[Instrumental]\n\n', source: 'genius', url: null } as LyricsResult },
    ]) {
      state.lyrics = q;
      const { unmount } = render(<TrackPageSections track={TRACK} />);
      expect(sectionNamed('Lyrics')).toBeNull();
      expect(screen.queryByText(/lyrics unavailable|couldn/i)).toBeNull();
      unmount();
    }
  });
});

describe('Artist and album cards', () => {
  it('the artist card: round photo, eyebrow, name, no made-up stat, links to the artist', () => {
    render(<TrackPageSections track={TRACK} />);
    const card = screen.getByTestId('artist-card');
    expect(card).toHaveAttribute('href', '/artist/UCnulls');
    expect(within(card).getByText('Artist')).toBeInTheDocument();
    expect(within(card).getByText('The Nulls')).toBeInTheDocument();
    const img = card.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://img.test/artist.jpg');
    expect(img.parentElement?.className).toContain('rounded-full');
    expect(img.parentElement?.className).toContain('size-18');
    expect(card.textContent).not.toMatch(/\d/);
  });

  it('the album card: cover, eyebrow, name, "11 songs · 2024", links to the album', () => {
    render(<TrackPageSections track={TRACK} />);
    const card = screen.getByTestId('album-card');
    expect(card).toHaveAttribute('href', '/album/MPREb_night');
    expect(within(card).getByText('Album')).toBeInTheDocument();
    expect(within(card).getByText('Night Shift')).toBeInTheDocument();
    expect(within(card).getByText('11 songs · 2024')).toBeInTheDocument();
    expect(card.querySelector('img')).toHaveAttribute('src', 'https://img.test/album.jpg');
  });

  it('side by side from md up when both show, stacked on a phone', () => {
    render(<TrackPageSections track={TRACK} />);
    const grid = sectionNamed('Artist and album')!;
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('md:grid-cols-2');
  });

  it('leaves out of the album line what the album data lacks', () => {
    expect(albumStat({ ...ALBUM, year: null })).toBe('11 songs');
    expect(albumStat({ ...ALBUM, trackCount: 0 })).toBe('2024');
    expect(albumStat({ ...ALBUM, trackCount: 1 })).toBe('1 song · 2024');
    expect(albumStat(undefined)).toBe('');
  });

  it('the album card still shows the song\'s album name before the album loads, with no stat line', () => {
    state.album = { data: undefined, isLoading: true };
    render(<TrackPageSections track={TRACK} />);
    const card = screen.getByTestId('album-card');
    expect(card).toHaveTextContent('AlbumNight Shift');
    expect(card.textContent).not.toMatch(/songs/);
  });

  it('no albumId: no album card, the artist card takes the whole width', () => {
    render(<TrackPageSections track={{ ...TRACK, albumId: null }} />);
    expect(screen.queryByTestId('album-card')).toBeNull();
    expect(screen.getByTestId('artist-card')).toBeInTheDocument();
    expect(sectionNamed('Artist and album')!.className).not.toContain('md:grid-cols-2');
  });

  it('no artistId: no artist card', () => {
    render(<TrackPageSections track={{ ...TRACK, artistId: null }} />);
    expect(screen.queryByTestId('artist-card')).toBeNull();
    expect(screen.getByTestId('album-card')).toBeInTheDocument();
  });

  it('neither: no cards section at all', () => {
    render(<TrackPageSections track={{ ...TRACK, artistId: null, albumId: null }} />);
    expect(sectionNamed('Artist and album')).toBeNull();
  });
});

describe('More by the artist', () => {
  it('a shelf of the artist\'s other albums and singles, linking to each, without this song\'s album', () => {
    render(<TrackPageSections track={TRACK} />);
    const shelf = sectionNamed('More by The Nulls')!;
    const links = within(shelf).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/album/MPREb_day');
    expect(links).toContain('/album/MPREb_single');
    expect(links).not.toContain('/album/MPREb_night');
    expect(within(shelf).queryByText('Night Shift')).toBeNull();
    // The artist page's own tiles and shelf.
    expect(shelf.querySelector('[data-row-shelf]')).not.toBeNull();
  });

  it('leaves out the song\'s album by name when the ids are spelled differently', () => {
    const left = otherReleases({ album: 'night shift', albumId: 'OLAK5uy_other' }, ARTIST);
    expect(left.map((a) => a.browseId)).toEqual(['MPREb_day', 'MPREb_single']);
  });

  it('hides when the artist has nothing else, or has not loaded', () => {
    state.artist = { data: { ...ARTIST, albums: [ARTIST.albums[0]], singles: [] } };
    const { unmount } = render(<TrackPageSections track={TRACK} />);
    expect(screen.queryByRole('region', { name: /More by/ })).toBeNull();
    unmount();
    state.artist = { data: undefined, isLoading: true };
    render(<TrackPageSections track={TRACK} />);
    expect(screen.queryByRole('region', { name: /More by/ })).toBeNull();
  });
});

describe('Similar songs', () => {
  it('lists at most 10 radio picks, without this song', () => {
    render(<TrackPageSections track={TRACK} />);
    const section = sectionNamed('Similar songs')!;
    expect(within(section).getByRole('heading', { name: 'Similar songs' })).toBeInTheDocument();
    expect(within(section).queryAllByText('Midnight Drive')).toHaveLength(0);
    const titles = RECS.slice(0, 10).map((t) => t.title);
    for (const title of titles) expect(within(section).queryAllByText(title).length).toBeGreaterThan(0);
    expect(within(section).queryAllByText('Song r10')).toHaveLength(0);
    // Each row keeps its menu.
    expect(within(section).getAllByRole('button', { name: /^More for Song r/ })).toHaveLength(10);
  });

  it('playing one queues the similar list', () => {
    render(<TrackPageSections track={TRACK} />);
    const section = sectionNamed('Similar songs')!;
    fireEvent.click(within(section).getAllByRole('button', { name: 'Play' })[2]);
    const [played, list] = state.onPlay.mock.calls[0];
    expect(played.id).toBe('youtube:r2');
    expect((list as Track[]).map((t) => t.id)).toEqual(RECS.slice(0, 10).map((t) => t.id));
  });

  it('leaves out another spelling of this same song', () => {
    const dup = { ...TRACK, id: 'youtube:youtube:a1' };
    expect(similarTo(TRACK, [dup, RECS[0]]).map((t) => t.id)).toEqual(['youtube:r0']);
  });

  it('hides when there are none, only this song, or while loading', () => {
    for (const q of [{ data: [] }, { data: [TRACK] }, { data: undefined, isLoading: true }]) {
      state.recommended = q;
      const { unmount } = render(<TrackPageSections track={TRACK} />);
      expect(sectionNamed('Similar songs')).toBeNull();
      unmount();
    }
  });

  it('only a YouTube song seeds radio', () => {
    render(<TrackPageSections track={{ ...TRACK, id: 'upload:u1', source: 'upload', sourceId: 'u1' }} />);
    expect(state.calls.recommended).toEqual(expect.arrayContaining([undefined]));
    expect(state.calls.recommended).not.toContain('u1');
  });
});
