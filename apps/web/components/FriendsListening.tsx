'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { MusicIcon } from '@/components/icons';

const POLL_MS = 30_000;

function agoLabel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'now';
  if (mins === 1) return '1 min ago';
  return `${mins} min ago`;
}

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
          <button
            key={`${item.userName}-${item.track.id}`}
            onClick={() => playTrack(item.track)}
            className="group w-40 shrink-0 rounded-md bg-card p-3 text-left hover:bg-card/80 transition-colors"
          >
            {item.track.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.track.artworkUrl}
                alt=""
                className="aspect-square w-full rounded object-cover bg-black"
              />
            ) : (
              <div className="aspect-square w-full rounded bg-black grid place-items-center text-foreground/20">
                <MusicIcon className="h-8 w-8" />
              </div>
            )}
            <div className="mt-2 truncate text-sm font-semibold">{item.track.title}</div>
            <div className="truncate text-xs text-muted-foreground">{item.track.artist}</div>
            <div className="mt-1.5 truncate text-xs text-ember">
              {item.userName} · {agoLabel(item.playedAt)}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
