'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrackShelf } from '@/components/track/TrackShelf';
import { TrackCard } from '@/components/track/TrackCard';
import {
  useQueryHistory,
  useQueryLikes,
  useQueryRecommended,
  useQueryTrending,
} from '@/hooks/useLibrary';
import { OnlineOnly } from '@/components/OnlineOnly';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useUiStore } from '@/stores/useUiStore';
import { FriendsListening } from '@/components/FriendsListening';
import type { Track } from '@/types/track';
import { PageTitle } from '@/components/page/PageTitle';
import { RowShelf } from '@/components/page/RowShelf';
import { CollectionCard } from '@/components/library/CollectionCard';
import { QuickGrid } from '@/components/home/QuickGrid';
import { HomeChips } from '@/components/home/HomeChips';
import { BecauseYouPlayed } from '@/components/home/BecauseYouPlayed';
import { useAuth } from '@/components/providers/AuthProvider';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useCollections } from '@/hooks/useCollections';
import { useQueryLiveCarlist } from '@/hooks/useSession';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { homeChips, phoneHomeView, quickPicks, recentFirst, type HomeFilter, type HomeRowKey } from '@/lib/home';
import { playlistCover } from '@/lib/collections';
import { publicName } from '@/lib/collab';

interface Section {
  key: string;
  title: string;
  /** The phone Home's name for the row, when it differs (order B renamed
   *  "Trending right now" to "Popular now"; the desktop keeps its title). */
  phoneTitle?: string;
  tracks: Track[];
  loading?: boolean;
  hidden?: boolean;
}

export default function HomePage() {
  const search = useSearchParams();
  const focus = search.get('focus');
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  // The shelves are presentational, so the page reads the lyrics flag and
  // renders the cards (with their playback state) itself.
  const lyricsOpen = useUiStore((s) => s.lyricsOpen);
  // A phone gets Spotify's mobile Home (quick grid, sideways rows); md and
  // up keep the desktop shelves. A media query, not md: classes, so only
  // one of the two layouts is ever in the page.
  const isDesktop = useIsDesktop();

  const renderTrack = (t: Track, list: Track[], variant: 'card' | 'tile') => {
    const active = current?.id === t.id;
    return (
      <TrackCard
        track={t}
        variant={variant}
        // Phone rows of songs read "Song · <artist>", Spotify's Recents tiles.
        kind={variant === 'tile' ? 'Song' : undefined}
        active={active}
        playing={isPlaying}
        // Same rule the card used to own: re-tapping the current track
        // toggles play/pause, any other card starts fresh.
        onActivate={() => (active ? toggle() : playTrack(t, list))}
      />
    );
  };
  const renderCard = (t: Track, list: Track[]) => renderTrack(t, list, 'card');
  const renderTile = (t: Track, list: Track[]) => renderTrack(t, list, 'tile');
  const { user } = useAuth();
  const [filter, setFilter] = useState<HomeFilter>('all');

  // Reset the scroll position whenever the focus changes, going INTO a
  // focused song box (so you start at its top) and coming back OUT (so the
  // home page restarts from the top, not wherever you were when you clicked
  // Show all from a lower row). We reset immediately AND across two
  // animation frames because the new content can shift the layout after
  // first paint (data resolving, image dimensions arriving, etc.), a
  // one-shot scroll lands "close to the top" but not all the way.
  useEffect(() => {
    // The page scrolls in the shell's scroller around <main>, not in <main>
    // itself (app/(app)/layout.tsx), so reset that one.
    const scroller = document.querySelector<HTMLElement>('[data-app-scroller]');
    if (!scroller) return;
    const reset = () => { scroller.scrollTop = 0; };
    reset();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      reset();
      raf2 = requestAnimationFrame(reset);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [focus]);

  const { data: history = [] } = useQueryHistory();
  const { data: liked = [] } = useQueryLikes();
  const { data: trending = [], isLoading: trendingLoading } = useQueryTrending();
  const seedTrack = history[0];
  const { data: recommended = [], isLoading: recommendedLoading } = useQueryRecommended(seedTrack?.sourceId);

  const { system, playlists } = useCollections();
  const { data: carlist } = useQueryLiveCarlist();
  const playbackContext = usePlayerStore((s) => s.context);
  const playingPlaylistId = playbackContext?.type === 'playlist' ? playbackContext.playlistId : null;

  const recsTitle = seedTrack ? `Because you played "${seedTrack.title}"` : 'Recommended for you';

  const sections: Section[] = [
    { key: 'recommended', title: recsTitle, tracks: recommended, loading: recommendedLoading },
    { key: 'trending', title: 'Trending right now', phoneTitle: 'Popular now', tracks: trending, loading: trendingLoading },
    { key: 'liked', title: 'From your liked songs', tracks: liked, hidden: liked.length === 0 },
    { key: 'history', title: 'Recently played', tracks: history, hidden: history.length === 0 },
  ];

  // The phone's rows (the owner's order B, lib/home.ts PHONE_ORDER) and
  // which of them have something to show, which also decides the chips.
  // "From your liked songs" is not one of them: Liked songs is in the grid.
  const available = new Set<HomeRowKey>(['friends']);
  if (history.length > 0) available.add('history');
  if (recommended.length > 0 || recommendedLoading) available.add('recommended');
  if (trending.length > 0 || trendingLoading) available.add('trending');
  if (playlists.length > 0) available.add('playlists');
  const chips = homeChips(available);
  const view = phoneHomeView(filter, available);
  const myName = publicName(user);

  const focused = focus ? sections.find((s) => s.key === focus && !s.hidden) : null;
  const titleOf = (sec: Section) => (!isDesktop && sec.phoneTitle) || sec.title;

  return (
    <OnlineOnly>
      {focused ? (
        <TrackShelf
          title={titleOf(focused)}
          tracks={focused.tracks}
          loading={focused.loading}
          renderCard={renderCard}
          lyricsOpen={lyricsOpen}
          fullscreen
        />
      ) : !isDesktop ? (
        <div>
          {chips.length > 1 && <HomeChips chips={chips} active={view.filter} onChange={setFilter} />}
          {view.quickGrid && (
            <QuickGrid
              items={quickPicks({
                liked: system.find((c) => c.ref.kind === 'liked'),
                playlists,
                carlist,
                playingPlaylistId,
              })}
            />
          )}
          {view.rows.map((key) => {
            if (key === 'playlists') {
              return (
                <RowShelf key={key} title="Your playlists" showAllHref="/library">
                  {recentFirst(playlists, playingPlaylistId).map((p) => (
                    <CollectionCard
                      key={p.href}
                      variant="tile"
                      size="md"
                      title={p.title}
                      subtitle={`Playlist · ${p.sharedBy?.name ?? myName}`}
                      href={p.href}
                      cover={{ icon: null, ...playlistCover(p.artworkUrl, p.trackArtworks) }}
                      badge={p.downloaded ? 'downloaded' : undefined}
                      shared={!!p.sharing}
                      sharedBy={p.sharedBy}
                    />
                  ))}
                </RowShelf>
              );
            }
            if (key === 'friends') return <FriendsListening key={key} layout="row" />;
            if (key === 'recommended') {
              return (
                <BecauseYouPlayed
                  key={key}
                  title={recsTitle}
                  seedArtist={seedTrack?.artist}
                  tracks={recommended}
                  loading={recommendedLoading}
                  currentId={current?.id}
                  isPlaying={isPlaying}
                  onPlay={playTrack}
                  onToggle={toggle}
                  showAllHref="/?focus=recommended"
                />
              );
            }
            const s = sections.find((x) => x.key === key);
            if (!s || s.hidden) return null;
            return (
              <TrackShelf
                key={s.key}
                layout="row"
                title={titleOf(s)}
                tracks={s.tracks}
                loading={s.loading}
                showAllHref={`/?focus=${encodeURIComponent(s.key)}`}
                renderCard={renderTile}
              />
            );
          })}
        </div>
      ) : (
        <div>
          <PageTitle className="mb-8">Home</PageTitle>
          <FriendsListening />
          {sections
            .filter((s) => !s.hidden)
            .map((s) => (
              <TrackShelf
                key={s.key}
                title={s.title}
                tracks={s.tracks}
                loading={s.loading}
                showAllHref={`/?focus=${encodeURIComponent(s.key)}`}
                renderCard={renderCard}
                lyricsOpen={lyricsOpen}
              />
            ))}
        </div>
      )}
    </OnlineOnly>
  );
}
