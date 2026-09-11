'use client';

import { useEffect } from 'react';
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

interface Section {
  key: string;
  title: string;
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

  const renderCard = (t: Track, list: Track[]) => {
    const active = current?.id === t.id;
    return (
      <TrackCard
        track={t}
        active={active}
        playing={isPlaying}
        // Same rule the card used to own: re-tapping the current track
        // toggles play/pause, any other card starts fresh.
        onActivate={() => (active ? toggle() : playTrack(t, list))}
      />
    );
  };

  // Reset the scroll position whenever the focus changes — going INTO a
  // focused song box (so you start at its top) and coming back OUT (so the
  // home page restarts from the top, not wherever you were when you clicked
  // Show all from a lower row). We reset immediately AND across two
  // animation frames because the new content can shift the layout after
  // first paint (data resolving, image dimensions arriving, etc.) — a
  // one-shot scroll lands "close to the top" but not all the way.
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const reset = () => { main.scrollTop = 0; };
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

  const recsTitle = seedTrack ? `Because you played "${seedTrack.title}"` : 'Recommended for you';

  const sections: Section[] = [
    { key: 'recommended', title: recsTitle, tracks: recommended, loading: recommendedLoading },
    { key: 'trending', title: 'Trending right now', tracks: trending, loading: trendingLoading },
    { key: 'liked', title: 'From your liked songs', tracks: liked, hidden: liked.length === 0 },
    { key: 'history', title: 'Recently played', tracks: history, hidden: history.length === 0 },
  ];

  const focused = focus ? sections.find((s) => s.key === focus && !s.hidden) : null;

  return (
    <OnlineOnly>
      {focused ? (
        <TrackShelf
          title={focused.title}
          tracks={focused.tracks}
          loading={focused.loading}
          renderCard={renderCard}
          lyricsOpen={lyricsOpen}
          fullscreen
        />
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
