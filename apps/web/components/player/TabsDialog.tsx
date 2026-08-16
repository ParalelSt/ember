'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { Track } from '@/types/track';

interface Props {
  track: Track | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Guitar tabs for the playing track (Songsterr).
 *
 *  Links out rather than embedding: Songsterr sends `X-Frame-Options: deny`,
 *  so showing the tab inside Ember isn't possible. Opening in the browser is
 *  the honest best available. */
export function TabsDialog({ track, open, onOpenChange }: Props) {
  const { data: matches = [], isFetching } = useQuery({
    queryKey: ['tabs', track?.id],
    queryFn: () => api.getTabs(track!.title, track!.artist).then((r) => r.matches),
    enabled: open && !!track?.title,
    staleTime: 60 * 60 * 1000,
  });

  const body = isFetching && matches.length === 0 ? (
    <div className="py-10 text-center text-sm text-muted-foreground">Looking for tabs…</div>
  ) : matches.length === 0 ? (
    <div className="py-10 text-center text-sm text-muted-foreground">
      No tabs found for this song.
    </div>
  ) : (
    <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto -mx-1 px-1">
      {matches.map((m) => (
        <a
          key={m.id}
          href={m.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-card transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{m.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {m.artist}
              {m.instruments.length > 0 && ` · ${m.instruments.join(', ')}`}
            </div>
          </div>
          {m.hasChords && (
            <span className="shrink-0 rounded bg-ember/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ember">
              chords
            </span>
          )}
        </a>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Guitar tabs</DialogTitle>
          <DialogDescription>
            {track ? `Matches for "${track.title}" — opens on Songsterr.` : 'Nothing playing.'}
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
