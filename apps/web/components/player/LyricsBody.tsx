'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { useLyricsAlignment } from '@/hooks/useLyricsAlignment';
import { useSilenceGapAdvance } from '@/hooks/useSilenceGapAdvance';
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

  // For plain (non-synced) lyrics we want the alignment hook to detect
  // the audio's intro silence — feed it a synthetic "first line at t=0"
  // so its computeOffset(tAudio, 0) returns the actual intro length.
  // That becomes the start anchor for section 0 in PlainSectionLyrics.
  const plainAnchor = useMemo<LyricsLine[] | null>(
    () => (!synced && data?.lyrics ? [{ time: 0, text: '' }] : null),
    [synced, data?.lyrics],
  );
  const alignmentOffset = useLyricsAlignment(current, synced ?? plainAnchor);

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
          <SyncedLyrics
            lines={synced}
            onSeek={seek}
            scrollerRef={scrollerRef}
            offset={alignmentOffset}
          />
        )}

        {/* Fallback view — sections distributed across the song by word
            weight, anchored on the alignment hook's detected intro
            silence. Each section gets a time slice proportional to its
            sung-word count so verses linger and one-liners don't. */}
        {current && data && !synced && data.lyrics && (
          <PlainSectionLyrics
            text={data.lyrics}
            scrollerRef={scrollerRef}
            introOffset={alignmentOffset}
            onSeek={seek}
          />
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

interface PlainSection {
  /** Raw multi-line text for display, including any leading [Section]
   *  marker. */
  text: string;
  /** Word count used to weight this section's time slice. Section
   *  markers like [Verse 1] are stripped before counting so they don't
   *  inflate the slice for sections that are otherwise short. Minimum 1
   *  so empty-ish sections still get a non-zero share. */
  weight: number;
}

/** Split plain lyric text into sections. Boundaries are blank lines and
 *  [Section] markers on their own line — both common conventions in
 *  Genius/LRCLib plain payloads. */
export function parsePlainLyricSections(text: string): PlainSection[] {
  const lines = text.split('\n');
  const sections: PlainSection[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const joined = current.join('\n').trim();
    current = [];
    if (joined.length === 0) return;
    const stripped = joined.replace(/\[[^\]]+\]/g, '').trim();
    const words = stripped.split(/\s+/).filter((w) => w.length > 0).length;
    sections.push({ text: joined, weight: Math.max(1, words) });
  };

  const markerRe = /^\s*\[[^\]]+\]\s*$/;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    // A [Section] marker on its own line starts a new section if we
    // already have content collected — otherwise it's just the header
    // of the section being built.
    if (markerRe.test(line) && current.length > 0) {
      flush();
    }
    current.push(line);
  }
  flush();
  return sections;
}

function PlainSectionLyrics({
  text,
  scrollerRef,
  introOffset,
  onSeek,
}: {
  text: string;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** Seconds of intro silence detected in the audio; section 0's
   *  anchor on a cold start. 0 while alignment is in flight. */
  introOffset: number;
  onSeek: (sec: number) => void;
}) {
  const { getCurrentTime, duration } = usePlayer();

  const sections = useMemo(() => parsePlainLyricSections(text), [text]);

  // Word-count-weighted distribution — used now only as (a) click-to-
  // seek targets and (b) the initial-activeIdx estimate for mid-song
  // joins. Section transitions during playback are driven by audio
  // silence-gap detection, not by this array.
  const sectionStarts = useMemo<number[]>(() => {
    if (sections.length === 0 || !duration || duration <= 0) return [];
    const intro = Math.max(0, Math.min(introOffset, duration));
    const singDuration = Math.max(0, duration - intro);
    const totalWeight = sections.reduce((s, sec) => s + sec.weight, 0);
    if (totalWeight === 0 || singDuration === 0) {
      return sections.map(() => intro);
    }
    let cum = 0;
    return sections.map((sec) => {
      const start = intro + (cum / totalWeight) * singDuration;
      cum += sec.weight;
      return start;
    });
  }, [sections, duration, introOffset]);

  // Event-driven active section. activeIdx + anchorTime are both
  // useState because anchorTime needs to reset on every transition so
  // the hook's dwell + fallback timers restart from now.
  const [activeIdx, setActiveIdx] = useState(-1);
  const [anchorTime, setAnchorTime] = useState(0);

  // Initial value on track / lyrics / intro change. Estimates which
  // section "should" be current given the current playback time using
  // the word-weighted map; the next silence event corrects it.
  useEffect(() => {
    if (sections.length === 0 || sectionStarts.length === 0) {
      setActiveIdx(-1);
      setAnchorTime(0);
      return;
    }
    const t = getCurrentTime();
    let idx = 0;
    for (let i = 0; i < sectionStarts.length; i++) {
      if (sectionStarts[i] <= t) idx = i;
      else break;
    }
    setActiveIdx(idx);
    setAnchorTime(sectionStarts[idx] ?? introOffset);
    // Mounted state is fully derived from these deps. We deliberately
    // do NOT include `getCurrentTime` — it's stable across renders,
    // and including it would make this re-run on every player render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, sectionStarts, introOffset]);

  const onAdvance = useCallback(() => {
    setActiveIdx((i) => {
      const next = Math.min(i + 1, sections.length - 1);
      if (next !== i) setAnchorTime(getCurrentTime());
      return next;
    });
  }, [sections.length, getCurrentTime]);

  useSilenceGapAdvance({
    enabled: sections.length > 1,
    onAdvance,
    anchorTime,
  });

  const sectionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Math-scroll the active section into the centre of the lyrics
  // container. Unchanged from the previous time-derived implementation
  // — same scrollDelta calculation, same container-only scroll.
  useEffect(() => {
    if (activeIdx < 0) return;
    const el = sectionRefs.current[activeIdx];
    const container = scrollerRef.current;
    if (!el || !container) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const scrollDelta =
      (elRect.top - containerRect.top)
      - container.clientHeight / 2
      + el.clientHeight / 2;
    container.scrollTo({ top: container.scrollTop + scrollDelta, behavior: 'smooth' });
  }, [activeIdx, scrollerRef]);

  if (sections.length === 0) return null;

  return (
    <div className="flex flex-col gap-5 py-2">
      {sections.map((sec, i) => {
        const isActive = i === activeIdx;
        const isPast = i < activeIdx;
        return (
          <button
            key={i}
            type="button"
            ref={(el) => {
              sectionRefs.current[i] = el;
            }}
            onClick={(e) => {
              // User intent overrides detection — jump the anchor
              // window to the clicked section's estimated start so
              // the hook restarts cleanly from there.
              const target = sectionStarts[i] ?? 0;
              onSeek(target);
              setActiveIdx(i);
              setAnchorTime(target);
              e.currentTarget.blur();
            }}
            className={cn(
              'text-left rounded-md px-3 py-2 text-sm leading-relaxed',
              'whitespace-pre-wrap cursor-pointer outline-none transition-colors duration-300',
              'focus-visible:bg-sidebar-foreground/10',
              isActive
                ? 'text-foreground font-semibold'
                : isPast
                  ? 'text-sidebar-foreground/30'
                  : 'text-sidebar-foreground/65 hover:text-sidebar-foreground',
            )}
          >
            {sec.text}
          </button>
        );
      })}
    </div>
  );
}

/** Karaoke-style lyric scroller: lines dim by distance from the current
 *  position, the active line is highlighted, and the active line is
 *  smooth-scrolled into the center of the lyrics scroller as the song
 *  plays. Clicking a line seeks playback to that timestamp. */
function SyncedLyrics({
  lines,
  onSeek,
  scrollerRef,
  offset,
}: {
  lines: LyricsLine[];
  onSeek: (t: number) => void;
  /** The overflow-y-auto container that wraps the lyrics. We scroll
   *  THIS element directly instead of using scrollIntoView so the
   *  outer app shell (search page, etc.) doesn't get scrolled along
   *  with the active line. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** Per-track LRC alignment offset (seconds), applied additively in
   *  the active-line lookup. 0 when alignment hasn't landed yet. */
  offset: number;
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
      // Subtract the per-track LRC offset so the line whose time matches
      // the *audible* moment lights up, rather than `audio.currentTime`.
      // Lookahead still covers the small fixed audio-output latency.
      const t = getCurrentTime() + HIGHLIGHT_LOOKAHEAD_SEC - offset;
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
  }, [lines, getCurrentTime, offset]);

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
