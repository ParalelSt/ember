'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CloseIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryLyrics, type LyricsLine } from '@/hooks/useLyrics';
import { cn } from '@/lib/utils';

interface Props {
  /** Active flag drives the lazy fetch — only goes to /api/lyrics while
   *  the wrapping panel/sheet is actually visible. */
  active: boolean;
  /** Wrapping context provides the close affordance — sheet has its own
   *  built-in via the overlay, the desktop panel renders an inline X. */
  onClose?: () => void;
  showHeader?: boolean;
}

export function LyricsBody({ active, onClose, showHeader = true }: Props) {
  const { current, seek } = usePlayer();
  const { data, isLoading, error } = useQueryLyrics(current, active);

  const [reportOpen, setReportOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Ref to the scrolling lyrics container — passed down to SyncedLyrics
  // so its active-line auto-scroll only moves THIS element, not the
  // outer app shell (search page, home, etc.).
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const submitReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/lyrics-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          trackTitle: current.title,
          trackArtist: current.artist,
          source: data?.source ?? 'unknown',
          note,
          lyrics: data?.lyrics ?? '',
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Request failed: ${res.status}`);
      }
      toast.success('Report sent — thanks');
      setNote('');
      setReportOpen(false);
    } catch (err) {
      toast.error(`Couldn't send: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const hasLyrics = !!current && !!data?.lyrics;
  const synced = data?.synced && data.synced.length > 0 ? data.synced : null;

  return (
    <>
      {showHeader && (
        <header className="px-4 py-4 border-b border-sidebar-border flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Lyrics</h2>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close lyrics"
              className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              <CloseIcon className="h-4 w-4" />
            </Button>
          )}
        </header>
      )}

      {current && (
        <div className="px-4 py-3 border-b border-sidebar-border flex items-center gap-3">
          {current.artworkUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.artworkUrl}
              alt=""
              className="h-12 w-12 rounded shrink-0 object-cover bg-black"
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{current.title}</div>
            <div className="truncate text-xs text-sidebar-foreground/55">{current.artist}</div>
          </div>
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-5 scrollbar-none [&::-webkit-scrollbar]:hidden">
        {!current && (
          <div className="text-sidebar-foreground/55 text-sm py-12 text-center">
            Play a track to see its lyrics.
          </div>
        )}

        {current && isLoading && (
          <div className="text-sidebar-foreground/55 text-sm py-12 text-center">
            Looking up the lyrics…
          </div>
        )}

        {current && error && (
          <div className="text-destructive text-sm py-12 text-center">
            Couldn&apos;t fetch lyrics: {(error as Error).message}
          </div>
        )}

        {current && data && synced && (
          <SyncedLyrics lines={synced} onSeek={seek} scrollerRef={scrollerRef} />
        )}

        {current && data && !synced && data.lyrics && (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-sidebar-foreground">
            {data.lyrics}
          </pre>
        )}

        {current && data && !synced && data.lyrics && data.url && (
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-block text-xs uppercase tracking-widest text-sidebar-foreground/55 hover:text-sidebar-foreground transition-colors"
          >
            Source: Genius
          </a>
        )}

        {current && data && synced && (
          <div className="mt-8 text-[10px] uppercase tracking-widest text-sidebar-foreground/40">
            Synced from LRCLib
          </div>
        )}

        {current && data && !data.lyrics && !synced && (
          <div className="text-sidebar-foreground/55 text-sm py-12 text-center">
            No lyrics found for this track.
          </div>
        )}
      </div>

      {hasLyrics && (
        <div className="border-t border-sidebar-border px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReportOpen(true)}
            className="text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
          >
            Report incorrect lyrics
          </Button>
        </div>
      )}

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitReport}>
            <DialogHeader>
              <DialogTitle>Report wrong lyrics</DialogTitle>
              <DialogDescription>
                What&apos;s wrong with the lyrics for &quot;{current?.title}&quot;? Goes to the project&apos;s Discord channel.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. The chorus is wrong / different song / wrong artist / missing the second verse…"
              maxLength={1000}
              rows={5}
              className="mt-4"
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setReportOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !note.trim()} className="bg-ember hover:bg-ember-soft text-white">
                Send
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Compensates for two compounding sources of perceived delay on
 *  the synced lyric highlight:
 *    - audio output latency from `audio.currentTime` to the speakers
 *      (~100-150ms wired, ~200-300ms Bluetooth)
 *    - the ~250ms granularity of the `timeupdate` event we read
 *      `position` from
 *  0.2s pulls the average highlight moment closer to the audible
 *  vocal start without going meaningfully early on well-timed LRCs. */
const LOOKAHEAD_SEC = 0.2;

/** Karaoke-style lyric scroller: lines dim by distance from the current
 *  position, the active line is highlighted, and the active line is
 *  smooth-scrolled into the center of the lyrics scroller as the song
 *  plays. Clicking a line seeks playback to that timestamp. */
function SyncedLyrics({
  lines,
  onSeek,
  scrollerRef,
}: {
  lines: LyricsLine[];
  onSeek: (t: number) => void;
  /** The overflow-y-auto container that wraps the lyrics. Auto-scroll
   *  is math-applied to THIS element directly — scrollIntoView walks
   *  up the ancestor chain and was yanking the main app scroller
   *  (search page, home, etc.) every time the active line changed. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { position } = usePlayer();

  // Binary search for the latest line whose timestamp is <= current position.
  const activeIdx = useMemo(() => {
    // Apply LOOKAHEAD_SEC to compensate for audio-output latency and
    // timeupdate granularity. See the constant's JSDoc above.
    const t = position + LOOKAHEAD_SEC;
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }, [lines, position]);

  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = lineRefs.current[activeIdx];
    const container = scrollerRef.current;
    if (!el || !container) return;
    // Scroll ONLY this container, not its ancestors. scrollIntoView
    // walks the ancestor chain and yanks the main app shell along
    // with the lyrics container, scrolling the search/home page.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const scrollDelta =
      (elRect.top - containerRect.top)
      - container.clientHeight / 2
      + el.clientHeight / 2;
    container.scrollTo({ top: container.scrollTop + scrollDelta, behavior: 'smooth' });
  }, [activeIdx, scrollerRef]);

  return (
    <div className="flex flex-col gap-2 py-2">
      {lines.map((line, i) => {
        const isActive = i === activeIdx;
        const isPast = i < activeIdx;
        const text = line.text || '♪';
        return (
          <button
            key={`${line.time}-${i}`}
            type="button"
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            // Blur after the click so Space (play/pause) doesn't replay
            // this button's onClick and seek the audio back to its
            // timestamp — the global Space handler can then pause instead.
            onClick={(e) => {
              onSeek(line.time);
              e.currentTarget.blur();
            }}
            className={cn(
              'text-left rounded-md px-2 py-1.5 text-sm transition-all duration-100',
              'leading-relaxed cursor-pointer outline-none',
              'focus-visible:bg-sidebar-foreground/10',
              // Keep font-size constant across all states so a long
              // active line doesn't re-wrap and shove the lines below it
              // out of view. Scale is a GPU transform — visible pop
              // without touching layout.
              isActive
                ? 'text-foreground font-semibold scale-[1.02] origin-left'
                : isPast
                  ? 'text-sidebar-foreground/30'
                  : 'text-sidebar-foreground/65 hover:text-sidebar-foreground',
            )}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
