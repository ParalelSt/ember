'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ShareIcon } from '@/components/icons';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

interface Props {
  track: Track;
  className?: string;
}

/** Share a track URL — native share sheet where available (phones),
 *  clipboard + toast everywhere else. YouTube tracks only: Jamendo has
 *  no stable share id. */
export function ShareButton({ track, className }: Props) {
  if (track.source !== 'youtube') return null;

  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/track/${track.sourceId}`;
    const title = `${track.title} — ${track.artist}`;
    if (navigator.share) {
      try {
        await navigator.share({ url, title });
      } catch {
        // User dismissed the sheet — not an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={share}
      aria-label={`Share ${track.title}`}
      title="Share"
      className={cn('h-8 w-8 text-muted-foreground hover:text-foreground', className)}
    >
      <ShareIcon className="h-4 w-4" />
    </Button>
  );
}
