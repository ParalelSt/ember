'use client';

import { TrackRow } from '@/components/track/TrackRow';
import {
  useQueryHistory,
  useQueryLikes,
  useQueryRecommended,
  useQueryTrending,
} from '@/hooks/useLibrary';

export default function HomePage() {
  const { data: history = [] } = useQueryHistory();
  const { data: liked = [] } = useQueryLikes();
  const { data: trending = [], isLoading: trendingLoading } = useQueryTrending();
  const seedTrack = history[0];
  const { data: recommended = [], isLoading: recommendedLoading } = useQueryRecommended(seedTrack?.sourceId);

  const recsTitle = seedTrack ? `Because you played "${seedTrack.title}"` : 'Recommended for you';

  return (
    <div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-8">Home</h1>
      <TrackRow title={recsTitle} tracks={recommended} loading={recommendedLoading} />
      <TrackRow title="Trending right now" tracks={trending} loading={trendingLoading} />
      {liked.length > 0 && <TrackRow title="From your liked songs" tracks={liked} />}
      {history.length > 0 && <TrackRow title="Recently played" tracks={history} />}
    </div>
  );
}
