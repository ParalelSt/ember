import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackShelf } from './TrackShelf';
import { SHELF_ROW_COUNT } from '@/lib/layout';
import type { Track } from '@/types/track';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function makeTracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `youtube:t${i}`,
    source: 'youtube' as const,
    sourceId: `t${i}`,
    title: `Track ${i}`,
    artist: 'The Nulls',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 100 + i,
    artworkUrl: null,
    streamUrl: '',
  }));
}

const renderCard = (t: Track) => <div>{t.title}</div>;

/** happy-dom reports a 1024px window, so set the width the shelf measures
 *  before rendering. 1024 is the lg breakpoint. */
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

describe('TrackShelf', () => {
  it('renders the title and every visible card', () => {
    setWidth(1280);
    render(<TrackShelf title="Trending right now" tracks={makeTracks(3)} renderCard={renderCard} />);
    expect(screen.getByRole('heading', { name: 'Trending right now' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders nothing when it has no tracks and is not loading', () => {
    setWidth(1280);
    const { container } = render(<TrackShelf title="Trending" tracks={[]} renderCard={renderCard} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only one row and a Show all link when the shelf overflows', () => {
    setWidth(1280);
    const visible = SHELF_ROW_COUNT.default.lg;
    render(
      <TrackShelf
        title="Trending"
        tracks={makeTracks(visible + 3)}
        showAllHref="/?focus=trending"
        renderCard={renderCard}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(visible);
    expect(screen.getByRole('link', { name: `Show all (${visible + 3})` })).toHaveAttribute(
      'href',
      '/?focus=trending',
    );
  });

  it('uses the narrower lyrics count when the lyrics panel is open', () => {
    setWidth(1280);
    render(
      <TrackShelf
        title="Trending"
        tracks={makeTracks(10)}
        showAllHref="/?focus=trending"
        renderCard={renderCard}
        lyricsOpen
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(SHELF_ROW_COUNT.lyrics.lg);
  });

  it('hides Show all when everything already fits', () => {
    setWidth(1280);
    render(
      <TrackShelf
        title="Trending"
        tracks={makeTracks(2)}
        showAllHref="/?focus=trending"
        renderCard={renderCard}
      />,
    );
    expect(screen.queryByRole('link', { name: /show all/i })).toBeNull();
  });

  it('renders every card plus a back link in fullscreen', () => {
    setWidth(1280);
    render(
      <TrackShelf title="Trending" tracks={makeTracks(9)} renderCard={renderCard} fullscreen />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('heading', { level: 1, name: 'Trending' })).toBeInTheDocument();
  });

  it('renders skeletons while loading with no tracks yet', () => {
    setWidth(1280);
    render(<TrackShelf title="Trending" tracks={undefined} loading renderCard={renderCard} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Trending' })).toBeInTheDocument();
  });
});
