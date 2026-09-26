'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TrackRow } from '@/components/track/TrackRow';
import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { localArtFor } from '@/lib/offlineNative';
import { isPlayableOffline } from '@/lib/playback/queueNav';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QueueSheet({ open, onOpenChange }: Props) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const { playAt } = usePlayer();
  const artFiles = useOfflineStore((s) => s.artFiles);
  // Downloaded tracks keep their art locally, so the queue still shows
  // thumbnails offline instead of a blank box from the dead remote URL.
  const artworkSrcFor = (track: Track) => localArtFor(track, artFiles) ?? track.artworkUrl ?? null;
  // Offline, songs with no copy on this device are dimmed: they will be
  // skipped until the connection is back.
  const online = useAutoCacheStore((s) => s.online);
  const cachedIds = useAutoCacheStore((s) => s.cachedIds);
  const webFiles = useOfflineStore((s) => s.webFiles);
  const trackFiles = useOfflineStore((s) => s.trackFiles);
  const pinned = online ? null : new Set([...Object.keys(webFiles), ...Object.keys(trackFiles)]);
  const outOfReach = (track: Track) => !!pinned && !isPlayableOffline(track, cachedIds, pinned);

  const current = queue[index] ?? null;
  const upcoming = queue.slice(index + 1);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-96 max-w-[90vw] flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border p-0">
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="text-base">Queue</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-3">
          {current && (
            <div>
              <div className="px-3 text-[11px] uppercase tracking-widest text-sidebar-foreground/55 mb-1.5">
                Now playing
              </div>
              {/* No onPlay: the current row is a label, not a control. */}
              <TrackRow
                track={current}
                density="compact"
                tone="sidebar"
                showDuration
                active
                artworkFallback={null}
                artworkSrc={artworkSrcFor(current)}
              />
            </div>
          )}

          {upcoming.length > 0 && (
            <div>
              <div className="px-3 text-[11px] uppercase tracking-widest text-sidebar-foreground/55 mb-1.5">
                Next up · {upcoming.length}
              </div>
              <div className="flex flex-col">
                {upcoming.map((t, i) => (
                  <TrackRow
                    key={`${t.id}-${index + 1 + i}`}
                    track={t}
                    density="compact"
                    tone="sidebar"
                    showDuration
                    artworkFallback={null}
                    artworkSrc={artworkSrcFor(t)}
                    className={cn('hover:bg-sidebar-accent/60', outOfReach(t) && 'opacity-50')}
                    // A jump inside the queue, not a new queue: playTrack
                    // would collapse a search-started queue to one song,
                    // turn shuffle off and move the loop point.
                    onPlay={() => playAt(index + 1 + i)}
                  />
                ))}
              </div>
            </div>
          )}

          {!current && upcoming.length === 0 && (
            <div className="text-sidebar-foreground/55 text-sm px-4 py-8 text-center">
              Queue is empty.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
