'use client';

import { WarningIcon } from '@/components/icons';
import { barLines, type BarLines } from '@/lib/playback/unplayableBar';
import type { BarMessage } from '@/lib/playback/unplayableBar';
import { cn } from '@/lib/utils';
import { dismissUnplayable, useUnplayableStore } from '@/stores/useUnplayableStore';

/** Where the message sits: the phone bar (in place of its artwork and
 *  song), the desktop bar's left cluster, the full-screen player's title. */
export type UnplayableMessageSize = 'bar' | 'desktop' | 'player';

/** The bar's message about songs that could not play, or null while the
 *  bar shows the song. */
export function useUnplayableMessage(): { message: BarMessage; lines: BarLines } | null {
  const message = useUnplayableStore((s) => s.message);
  return message ? { message, lines: barLines(message) } : null;
}

export interface UnplayableMessageProps {
  size: UnplayableMessageSize;
  /** A passing failure: tapping loads the song again. */
  onRetry?: () => void;
  /** Anything else: tapping opens the queue, where the songs are listed
   *  under "Couldn't play" with their reasons. */
  onOpenQueue?: () => void;
  className?: string;
}

/** The warning in place of the song (the owner's pick, option B): a warning
 *  sign where the artwork was, a bold headline ("Skipped: <title>",
 *  "Skipped 3 songs", "Playback stopped") and the reason under it. Same box
 *  as the song it covers, so nothing jumps; the transport buttons beside it
 *  stay live. Says nothing to a screen reader itself: UnplayableAnnouncer
 *  does, once, whichever views are open. */
export function UnplayableMessage({ size, onRetry, onOpenQueue, className }: UnplayableMessageProps) {
  const shown = useUnplayableMessage();
  if (!shown) return null;
  const { message, lines } = shown;
  // Stopped: the danger colour, it needs an answer. A skip: the accent.
  const tone = lines.sticky ? 'text-destructive' : 'text-ember';
  const onClick = () => {
    dismissUnplayable();
    if (lines.retry) onRetry?.();
    else onOpenQueue?.();
  };

  if (size === 'player') {
    return (
      <button
        type="button"
        key={message.key}
        onClick={onClick}
        data-testid="unplayable-message"
        data-size={size}
        className={cn('flex min-w-0 flex-1 items-start gap-cluster text-left animate-in fade-in duration-200', className)}
      >
        <WarningIcon aria-hidden className={cn('mt-inset size-6 shrink-0', tone)} />
        <span className="min-w-0 flex-1">
          <span data-testid="unplayable-top" className="block truncate text-2xl font-bold tracking-tight">{lines.top}</span>
          <span data-testid="unplayable-bottom" className="mt-inset block truncate text-sm text-muted-foreground">{lines.bottom}</span>
        </span>
      </button>
    );
  }

  const bar = size === 'bar';
  return (
    <button
      type="button"
      key={message.key}
      onClick={onClick}
      data-testid="unplayable-message"
      data-size={size}
      className={cn('flex min-w-0 flex-1 items-center gap-row text-left animate-in fade-in slide-in-from-bottom-1 duration-200', className)}
    >
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-md bg-foreground/10',
          bar ? 'size-art-bar' : 'size-art-sm',
        )}
      >
        <WarningIcon aria-hidden className={cn(bar ? 'size-6' : 'size-5', tone)} />
      </span>
      <span className="min-w-0 flex-1">
        <span data-testid="unplayable-top" className={cn('block truncate font-semibold', bar ? 'text-base' : 'text-sm')}>
          {lines.top}
        </span>
        <span data-testid="unplayable-bottom" className={cn('block truncate text-muted-foreground', bar ? 'text-sm' : 'text-xs')}>
          {lines.bottom}
        </span>
      </span>
    </button>
  );
}

/** The one polite announcement of the bar's message, for screen readers
 *  (the whole sentence: which song, why, what happened). Always mounted, so
 *  the live region exists before anything is said into it. */
export function UnplayableAnnouncer() {
  const shown = useUnplayableMessage();
  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="unplayable-announcer" className="sr-only">
      {shown?.lines.announcement ?? ''}
    </div>
  );
}
