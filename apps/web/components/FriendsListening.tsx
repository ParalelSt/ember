'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { MusicIcon } from '@/components/icons';
import { TrackCard } from '@/components/track/TrackCard';
import { formatAgo } from '@/lib/format';

const POLL_MS = 30_000;

const MUSIC_ICON_FALLBACK = <MusicIcon className="h-8 w-8" data-testid="music-fallback" />;

/** Home section: what other members played in the last ~30 minutes (newest
 *  per person). Hidden entirely when nobody's listening — no empty state. */
export function FriendsListening() {
  const { user } = useAuth();
  const { playTrack } = usePlayer();
  const { data } = useQuery({
    queryKey: ['listening'],
    queryFn: () => api.listening().then((r) => r.items),
    enabled: !!user,
    refetchInterval: POLL_MS,
  });

  if (!data?.length) return null;

  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold tracking-tight mb-4">Friends are listening to</h2>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
        {data.map((item) => (
          // Fixed width + shrink-0 so the row scrolls horizontally instead
          // of wrapping; TrackCard itself is width-agnostic (it fills
          // whatever box it's given, same as it does in a shelf's grid
          // column). No active/playing state here, same as before this
          // step: these cards never tracked whether their track was the
          // one currently playing.
          <div key={`${item.userName}-${item.track.id}`} className="w-40 shrink-0">
            <TrackCard
              track={item.track}
              onActivate={() => playTrack(item.track)}
              subtitle={`${item.userName} · ${formatAgo(item.playedAt)}`}
              artworkFallback={MUSIC_ICON_FALLBACK}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
