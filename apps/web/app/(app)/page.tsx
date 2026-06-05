'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrackRow } from '@/components/track/TrackRow';
import {
  useQueryHistory,
  useQueryLikes,
  useQueryRecommended,
  useQueryTrending,
} from '@/hooks/useLibrary';
import type { Track } from '@/types/track';

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

  if (focused) {
    return (
      <TrackRow
        title={focused.title}
        tracks={focused.tracks}
        loading={focused.loading}
        focusKey={focused.key}
        fullscreen
      />
    );
  }

  return (
    <div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-8">Home</h1>
      {sections
        .filter((s) => !s.hidden)
        .map((s) => (
          <TrackRow
            key={s.key}
            title={s.title}
            tracks={s.tracks}
            loading={s.loading}
            focusKey={s.key}
          />
        ))}
    </div>
  );
}
