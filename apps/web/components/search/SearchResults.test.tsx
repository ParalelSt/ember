import fs from 'node:fs';
import path from 'node:path';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MAX_STAGGER_ROWS, SearchResults, STAGGER_MS, type SearchResultsPlatform } from './SearchResults';
import { buildSearchView } from '@/lib/search/view';
import { EMPTY_SEARCH_PARTS, type SearchParts } from '@/lib/search/types';
import type { Track } from '@/types/track';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: { message: vi.fn() } }));

const t = (id: string, title = id, source: Track['source'] = 'youtube'): Track => ({
  id: `${source}:${id}`,
  source,
  sourceId: id,
  title,
  artist: 'Band',
  artistId: 'UCband',
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: `https://example.test/${id}.jpg`,
  streamUrl: '',
});

const parts = (p: Partial<SearchParts>): SearchParts => ({ ...EMPTY_SEARCH_PARTS, ...p });

function renderResults(
  view = buildSearchView('x', parts({ uploads: [], artists: [], songs: [t('a1', 'First'), t('b2', 'Second')], videos: [] })),
  platform: SearchResultsPlatform = 'desktop',
) {
  const onPlay = vi.fn();
  const props = {
    view,
    platform,
    context: { type: 'search' as const, query: 'x' },
    trailingPlayControl: true,
    currentId: null,
    isPlaying: false,
    likedIds: new Set<string>(),
    onPlay,
    onToggle: vi.fn(),
  };
  const utils = render(<SearchResults {...props} />);
  return { ...utils, onPlay, props };
}

const rows = () => screen.getAllByTestId('search-row');
const delays = () => rows().map((r) => r.style.animationDelay);

describe('SearchResults: click targets', () => {
  it('desktop: the cover and the title open the song page, the play button plays the list', () => {
    const { onPlay, props } = renderResults();
    const first = rows()[0];
    expect(within(first).getByTestId('track-row-cover-link')).toHaveAttribute('href', '/track/a1');
    const title = within(first).getByTestId('track-row-title-link');
    expect(title).toHaveAttribute('href', '/track/a1');
    fireEvent.click(title);
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(within(first).getByTestId('track-row-play'));
    expect(onPlay).toHaveBeenCalledWith(props.view.tracks[0], props.view.tracks, { type: 'search', query: 'x' });
  });

  it('desktop: a title too long for its column scrolls inside the song link', () => {
    renderResults();
    const link = within(rows()[0]).getByTestId('track-row-title-link');
    expect(link.querySelector('[data-testid="marquee"]')).not.toBeNull();
  });

  it('phone: only the cover opens the song page; the title plays and scrolls when long', () => {
    const { onPlay } = renderResults(undefined, 'phone');
    const first = rows()[0];
    expect(within(first).getByTestId('track-row-cover-link')).toHaveAttribute('href', '/track/a1');
    expect(within(first).queryByTestId('track-row-title-link')).toBeNull();
    const title = within(first).getByTestId('track-row-title');
    expect(title.querySelector('[data-testid="marquee"]')).not.toBeNull();
    fireEvent.click(title);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('phone rows keep their buttons (play, menu slot) beside the scrolling title', () => {
    renderResults(undefined, 'phone');
    expect(within(rows()[0]).getByTestId('track-row-play')).toBeInTheDocument();
  });

  it('an upload has no song page: no links, the cover plays', () => {
    const view = buildSearchView('x', parts({ uploads: [t('u1', 'Mine', 'upload')], artists: [], songs: [], videos: [] }));
    const { onPlay } = renderResults(view);
    expect(screen.queryByTestId('track-row-cover-link')).toBeNull();
    expect(screen.queryByTestId('track-row-title-link')).toBeNull();
    fireEvent.click(rows()[0].querySelector('img')!.parentElement!);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('says No tracks when there is nothing', () => {
    renderResults(buildSearchView('x', parts({ uploads: [], artists: [], songs: [], videos: [] })));
    expect(screen.getByText('No tracks')).toBeInTheDocument();
  });
});

describe('SearchResults: the Artists section', () => {
  const artists = [
    { id: 'UCdemetori', name: 'Demetori', artworkUrl: 'https://example.test/d.jpg' },
    { id: 'UCother', name: 'Demetori Tribute', artworkUrl: null },
  ];

  it('shows each artist round, with its name and "Artist", opening its page', () => {
    renderResults(buildSearchView('demetori', parts({ uploads: [], artists, songs: [t('a1')], videos: [] })));
    const section = screen.getByTestId('search-artists');
    expect(within(section).getByText('Artists')).toBeInTheDocument();
    const links = within(section).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/artist/UCdemetori', '/artist/UCother']);
    expect(within(links[0]).getByText('Demetori')).toBeInTheDocument();
    expect(within(links[0]).getByText('Artist')).toBeInTheDocument();
    expect(links[0].querySelector('.rounded-full')).not.toBeNull();
  });

  it('desktop: the artists are list rows, round picture, name, "Artist" and an arrow', () => {
    renderResults(buildSearchView('demetori', parts({ uploads: [], artists, songs: [t('a1')], videos: [] })), 'desktop');
    const section = screen.getByTestId('search-artists');
    expect(section).toHaveAttribute('data-layout', 'rows');
    expect(section.querySelector('.grid-cols-3')).toBeNull();
    const links = within(section).getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.className).toContain('items-center');
      expect(link.className).not.toContain('flex-col');
      expect(link.querySelector('.rounded-full')).not.toBeNull();
      expect(link.querySelector('.phosphor-caret-right')).not.toBeNull();
      expect(within(link).getByText('Artist')).toBeInTheDocument();
    }
    expect(within(links[1]).getByText('Demetori Tribute')).toBeInTheDocument();
  });

  it('desktop: an artist row is boxed like the song rows, the arrow inside it at the right (owner report)', () => {
    renderResults(buildSearchView('demetori', parts({ uploads: [], artists, songs: [t('a1')], videos: [] })), 'desktop');
    const link = screen.getAllByTestId('search-artist-row')[0];
    const song = screen.getByTestId('track-row');
    // The same box: grid, gap, padding, radius and hover as a song row.
    for (const c of ['grid', 'items-center', 'gap-3', 'py-2', 'rounded-md', 'hover:bg-card', 'transition-colors']) {
      expect(link, c).toHaveClass(c);
      expect(song, c).toHaveClass(c);
    }
    expect(link).toHaveClass('w-full', 'min-w-0');
    // Two columns, like the overlay's song rows (they play from the right):
    // the picture and name, then the arrow in a button-sized cell.
    expect(link.className).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(link.className).not.toContain('40px');
    const arrow = within(link).getByTestId('search-artist-arrow');
    expect(arrow).toHaveClass('size-8', 'place-items-center');
    expect(arrow.querySelector('.phosphor-caret-right')).not.toBeNull();
    expect(link.lastElementChild).toBe(arrow);
    expect(within(link).getByText('Demetori')).toHaveClass('truncate', 'font-semibold');
  });

  it('desktop search page: the songs have a play column on the left, and the artist rows keep it too', () => {
    const view = buildSearchView('demetori', parts({ uploads: [], artists, songs: [t('a1')], videos: [] }));
    render(
      <SearchResults
        view={view}
        platform="desktop"
        context={{ type: 'search', query: 'demetori' }}
        trailingPlayControl={false}
        currentId={null}
        isPlaying={false}
        likedIds={new Set()}
        onPlay={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const link = screen.getAllByTestId('search-artist-row')[0];
    expect(link.className).toContain('@3xl:grid-cols-[40px_minmax(0,1fr)_auto]');
    expect(screen.getByTestId('track-row').className).toContain('@3xl:grid-cols-[40px_');
    const spacer = link.firstElementChild as HTMLElement;
    expect(spacer).toHaveAttribute('aria-hidden');
    expect(spacer).toHaveClass('hidden', '@3xl:block', 'size-8');
    expect(link.lastElementChild).toBe(within(link).getByTestId('search-artist-arrow'));
  });

  it('phone: the artists stay side by side as circles, with no arrow', () => {
    renderResults(buildSearchView('demetori', parts({ uploads: [], artists, songs: [t('a1')], videos: [] })), 'phone');
    const section = screen.getByTestId('search-artists');
    expect(section).toHaveAttribute('data-layout', 'grid');
    expect(section.querySelector('.grid-cols-3')).not.toBeNull();
    const links = within(section).getAllByRole('link');
    expect(links[0].className).toContain('flex-col');
    expect(section.querySelector('.phosphor-caret-right')).toBeNull();
  });

  it('a direct artist search puts it first', () => {
    renderResults(buildSearchView('demetori', parts({ uploads: [], artists, songs: [t('a1'), t('b2')], videos: [] })));
    expect(rows()[0]).toContainElement(screen.getByTestId('search-artists'));
  });

  it('otherwise it sits under the first three songs', () => {
    const songs = [t('a1'), t('b2'), t('c3'), t('d4')];
    renderResults(buildSearchView('something else', parts({ uploads: [], artists, songs, videos: [] })));
    expect(rows()[3]).toContainElement(screen.getByTestId('search-artists'));
  });
});

describe('SearchResults: rows fade in one after another', () => {
  it('each row starts a moment after the row above', () => {
    renderResults(buildSearchView('x', parts({ uploads: [], artists: [], songs: [t('a1'), t('b2'), t('c3')], videos: [] })));
    expect(rows().every((r) => r.classList.contains('ember-row-in'))).toBe(true);
    expect(delays()).toEqual(['0ms', `${STAGGER_MS}ms`, `${2 * STAGGER_MS}ms`]);
  });

  it('a later group staggers from its own first row, and rows already shown keep their timing', () => {
    // Songs that match the query, so they show before the videos arrive.
    const p1 = parts({ uploads: [], artists: [], songs: [t('a1', 'x one'), t('b2', 'x two')] });
    const { rerender, props } = renderResults(buildSearchView('x', p1));
    const before = delays();
    expect(before).toHaveLength(2);
    const p2 = { ...p1, videos: [t('v1'), t('v2')] };
    rerender(<SearchResults {...props} view={buildSearchView('x', p2)} />);
    expect(delays()).toEqual([...before, '0ms', `${STAGGER_MS}ms`]);
  });

  it('a long arrival stops adding delay after a dozen rows', () => {
    const songs = Array.from({ length: 20 }, (_, i) => t(`s${i}`));
    renderResults(buildSearchView('x', parts({ uploads: [], artists: [], songs, videos: [] })));
    expect(delays().at(-1)).toBe(`${MAX_STAGGER_ROWS * STAGGER_MS}ms`);
  });

  describe('the stylesheet', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8');

    it('fades opacity only, so a row has its full height from the first frame (no layout jump)', () => {
      const frames = css.match(/@keyframes ember-row-in\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
      expect(frames).toMatch(/opacity/);
      expect(frames).not.toMatch(/height|margin|padding|max-height|transform|top/);
      // `both`: invisible during its delay, then stays visible.
      expect(css).toMatch(/\.ember-row-in\s*\{[^}]*\bboth\b/);
    });

    it('with reduced motion the rows simply appear', () => {
      const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
      expect(reduced.some((block) => /\.ember-row-in\s*\{\s*animation:\s*none/.test(block))).toBe(true);
    });
  });
});
