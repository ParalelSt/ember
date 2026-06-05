'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fmt(sec: number | undefined): string {
  if (!sec || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function QueueSheet({ open, onOpenChange }: Props) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const context = usePlayerStore((s) => s.context);
  const { playTrack } = usePlayer();

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
              <Row track={current} highlight />
            </div>
          )}

          {upcoming.length > 0 && (
            <div>
              <div className="px-3 text-[11px] uppercase tracking-widest text-sidebar-foreground/55 mb-1.5">
                Next up · {upcoming.length}
              </div>
              <div className="flex flex-col">
                {upcoming.map((t, i) => (
                  <Row
                    key={`${t.id}-${index + 1 + i}`}
                    track={t}
                    onClick={() => playTrack(t, queue, context)}
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

interface RowProps {
  track: { id: string; title: string; artist: string; artworkUrl: string | null; durationSec: number };
  highlight?: boolean;
  onClick?: () => void;
}

function Row({ track, highlight, onClick }: RowProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 items-center px-3 py-2 rounded-md transition-colors',
        onClick && 'cursor-pointer hover:bg-sidebar-accent/60',
        highlight && 'text-ember',
      )}
    >
      <div className="relative h-10 w-10 rounded bg-black overflow-hidden shrink-0">
        {track.artworkUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={track.artworkUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{track.title}</div>
        <div className="truncate text-xs text-sidebar-foreground/55">{track.artist}</div>
      </div>
      <div className="text-xs text-sidebar-foreground/55 tabular-nums">{fmt(track.durationSec)}</div>
    </div>
  );
}
