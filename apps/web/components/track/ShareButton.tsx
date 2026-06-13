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

/** Last-resort copy for non-secure contexts (e.g. http://<LAN-IP>), where
 *  navigator.share and navigator.clipboard are both unavailable. Uses the
 *  legacy execCommand path via a throwaway textarea. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Share a track URL — native share sheet where available (phones, secure
 *  context), clipboard otherwise, legacy execCommand as the final fallback.
 *  YouTube tracks only: Jamendo has no stable share id. */
export function ShareButton({ track, className }: Props) {
  if (track.source !== 'youtube') return null;

  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/track/${track.sourceId}`;
    const title = `${track.title} — ${track.artist}`;

    // 1. Native share sheet (mobile). Requires a secure context.
    if (navigator.share) {
      try {
        await navigator.share({ url, title });
        return;
      } catch (err) {
        // AbortError = user dismissed the sheet → done, don't also copy.
        if ((err as Error)?.name === 'AbortError') return;
        // Any other share failure → fall through to copy.
      }
    }

    // 2. Async Clipboard API (secure context only).
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied');
        return;
      } catch {
        // Fall through to the legacy path.
      }
    }

    // 3. Legacy copy — works over plain http / older browsers.
    if (legacyCopy(url)) toast.success('Link copied');
    else toast.error("Couldn't copy — open over the https link to share");
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
