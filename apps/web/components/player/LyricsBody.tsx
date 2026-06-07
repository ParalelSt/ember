'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
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

  // Non-synced tracks fall back to plain text with a Spotify-style
  // proportional auto-scroll — the container glides through the lyrics
  // with playback without pretending to know which line is current.
  usePlainLyricsAutoScroll(scrollerRef, !synced && !!data?.lyrics);

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

        {/* Karaoke view — only when LRCLib gave us real per-line LRC
            timestamps. Highlights + auto-scrolls + click-to-seek. */}
        {current && synced && (
          <SyncedLyrics lines={synced} onSeek={seek} scrollerRef={scrollerRef} />
        )}

        {/* Fallback view — plain text that scrolls proportionally with
            playback (see usePlainLyricsAutoScroll above). No per-line
            highlight: we don't fake timing data we don't have. */}
        {current && data && !synced && data.lyrics && (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-sidebar-foreground">
            {data.lyrics}
          </pre>
        )}

        {current && data && (data.lyrics || synced) && (
          <div className="mt-8 text-[10px] uppercase tracking-widest text-sidebar-foreground/40 flex items-center gap-2">
            <span>
              {synced
                ? 'Synced from LRCLib'
                : data.source === 'lrclib'
                  ? 'Lyrics from LRCLib'
                  : data.source === 'genius'
                    ? 'Lyrics from Genius'
                    : null}
            </span>
            {!synced && data.url && (
              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-sidebar-foreground transition-colors underline"
              >
                source
              </a>
            )}
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

/** Fallback for tracks without real LRC timestamps: scrolls the lyrics
 *  container linearly with playback progress so the words you're
 *  hearing stay roughly in view. No per-line highlight — we don't have
 *  reliable timing data and faking it just looks wrong. Backs off for
 *  ~4s after any user input (wheel / touch / arrow keys) so the reader
 *  can scan ahead or back without being yanked.
 *
 *  Implementation: a single rAF loop that eases `scrollTop` toward
 *  `scrollable × (position / duration)` each frame. Calling
 *  `scrollTo({ behavior: 'smooth' })` on every position update is the
 *  WRONG approach — `timeupdate` fires ~4×/s and each new scrollTo
 *  interrupts the previous one's animation, so the scroller never
 *  settles and feels like it's running away. The rAF approach gives a
 *  steady glide that exactly tracks playback. */
function usePlainLyricsAutoScroll(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const { position, duration } = usePlayer();
  const positionRef = useRef(position);
  const durationRef = useRef(duration);
  const lastUserInputAt = useRef(0);

  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollerRef.current;
    if (!el) return;
    // Listen for ACTUAL user inputs rather than 'scroll' events, which
    // also fire from our own programmatic scrolling and made the prior
    // implementation see itself as the user every frame.
    const mark = () => { lastUserInputAt.current = performance.now(); };
    el.addEventListener('wheel', mark, { passive: true });
    el.addEventListener('touchmove', mark, { passive: true });
    el.addEventListener('keydown', mark);
    return () => {
      el.removeEventListener('wheel', mark);
      el.removeEventListener('touchmove', mark);
      el.removeEventListener('keydown', mark);
    };
  }, [enabled, scrollerRef]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      // 4-second grace period after any user input.
      if (performance.now() - lastUserInputAt.current >= 4000) {
        const d = durationRef.current;
        const p = positionRef.current;
        if (d > 0) {
          const scrollable = el.scrollHeight - el.clientHeight;
          if (scrollable > 0) {
            const progress = Math.max(0, Math.min(1, p / d));
            const target = scrollable * progress;
            // Ease 8% of the remaining distance per frame. Slow enough
            // to read comfortably, fast enough to stay in sync with
            // the song's progress.
            const next = el.scrollTop + (target - el.scrollTop) * 0.08;
            if (Math.abs(next - el.scrollTop) > 0.05) {
              el.scrollTop = next;
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, scrollerRef]);
}

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
  /** The overflow-y-auto container that wraps the lyrics. We scroll
   *  THIS element directly instead of using scrollIntoView so the
   *  outer app shell (search page, etc.) doesn't get scrolled along
   *  with the active line. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { getCurrentTime } = usePlayer();

  // rAF-driven active line so the highlight lands within one frame
  // (~16ms) of the audio crossing a line timestamp — `timeupdate`
  // only fires ~4×/s, which left the highlight visibly trailing the
  // singer by up to ~250ms.
  //
  // Lookahead bias: `audio.currentTime` reflects the playhead inside
  // the element, but actual sound output through the buffer +
  // soundcard/speakers/Bluetooth is ~150–300ms behind that. LRC
  // timestamps also mark the START of a line, so matching strictly
  // (time ≤ now) puts the highlight visibly behind the singer. Adding
  // a small forward bias snaps the highlight onto each line slightly
  // before its first syllable lands — which to the user reads as "in
  // sync." 0.35s is a Spotify-ish middle ground.
  const HIGHLIGHT_LOOKAHEAD_SEC = 0.35;
  const [activeIdx, setActiveIdx] = useState(-1);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = getCurrentTime() + HIGHLIGHT_LOOKAHEAD_SEC;
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
      // setActiveIdx with the same value is a no-op (React bails),
      // so this only re-renders on actual line transitions.
      setActiveIdx(ans);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines, getCurrentTime]);

  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = lineRefs.current[activeIdx];
    const container = scrollerRef.current;
    if (!el || !container) return;
    // Scroll ONLY this container (not its ancestors). scrollIntoView
    // walks up the ancestor chain and was yanking the main app
    // scroller (search page, home, etc.) along with it.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset =
      (elRect.top - containerRect.top)
      - container.clientHeight / 2
      + el.clientHeight / 2;
    container.scrollTo({ top: container.scrollTop + offset, behavior: 'smooth' });
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
            // Blur after the click so Space doesn't replay the click on
            // this button and seek back to its timestamp — the global
            // spacebar handler in PlayerProvider can then handle pause.
            onClick={(e) => {
              onSeek(line.time);
              e.currentTarget.blur();
            }}
            className={cn(
              'text-left rounded-md px-2 py-1.5 text-sm transition-all duration-300',
              'leading-relaxed cursor-pointer outline-none',
              'focus-visible:bg-sidebar-foreground/10',
              // Keep font-size constant across all states so a long
              // active line doesn't re-wrap and shove the column. Scale
              // is a GPU transform — gives the active line a slight pop
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
