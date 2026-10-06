'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TrackRow } from '@/components/track/TrackRow';
import { CouldntPlaySection, couldntPlayEntries } from '@/components/player/CouldntPlaySection';
import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { localArtFor } from '@/lib/offlineNative';
import { isPlayableOffline, isUnavailable, playedWalk } from '@/lib/playback/queueNav';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { useUnplayableStore } from '@/stores/useUnplayableStore';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

/** The sheet's section headings: "Played", "Couldn't play", "Next up". */
const SECTION_LABEL = 'px-3 text-[11px] uppercase tracking-widest text-sidebar-foreground/55 mb-1.5';

/** The thin line under the Now playing card, following playback. Its own
 *  component so the position's many updates re-render only the line. */
function NowProgress() {
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const pct = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  return (
    <div className="mx-row h-0.5 overflow-hidden rounded-full bg-sidebar-foreground/15" aria-hidden>
      <div data-testid="now-progress-fill" className="h-full rounded-full bg-ember" style={{ width: `${pct}%` }} />
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QueueSheet({ open, onOpenChange }: Props) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const played = usePlayerStore((s) => s.played);
  const { playAt, playBack } = usePlayer();
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
  // This session's songs that could not play, still in this queue.
  const couldntPlay = useUnplayableStore((s) => s.couldntPlay);
  const failed = couldntPlayEntries(couldntPlay, queue, current?.id ?? null);
  // This session's songs played before this one: exactly what Previous
  // walks back through (newest first there; oldest first here, so the
  // newest sits right above Now playing).
  const history = current ? playedWalk(queue, index, played).map((step) => queue[step.index]).reverse() : [];

  // The sheet opens scrolled so Now playing (with "Couldn't play" right
  // above it) is at the top: the history is only seen by scrolling up.
  // Again each time it opens, and a new song while open glides to it.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const landedRef = useRef(false);
  const land = useCallback((smooth: boolean) => {
    const sc = scrollerRef.current;
    const anchor = anchorRef.current;
    if (!sc || !anchor) return;
    // Room under Now playing for it to reach the top when Next up is short
    // (a scroll stops at the end of the list).
    const spacer = spacerRef.current;
    if (spacer) {
      spacer.style.height = '0px';
      spacer.style.height = `${Math.max(0, sc.clientHeight - (sc.scrollHeight - anchor.offsetTop))}px`;
    }
    const top = anchor.offsetTop;
    if (smooth && typeof sc.scrollTo === 'function') sc.scrollTo({ top, behavior: 'smooth' });
    else sc.scrollTop = top;
  }, []);
  // The sheet's content mounts in a portal, possibly after this component's
  // own layout effects: landing when the list itself mounts covers that.
  const scrollerMounted = useCallback((node: HTMLDivElement | null) => {
    scrollerRef.current = node;
    if (node) {
      land(false);
      landedRef.current = true;
    }
  }, [land]);
  const currentKey = current ? `${current.id}-${index}` : null;
  useLayoutEffect(() => {
    if (!open) {
      landedRef.current = false;
      return;
    }
    land(landedRef.current);
    landedRef.current = true;
  }, [open, currentKey, land]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Width named under the sheet's own side variant: its default
          (data-[side=right]:w-3/4) outranks a plain w-96, which left the
          queue at three quarters of a phone, too narrow for "Couldn't play"'s
          reason lines. 90% of a phone, as in the owner's pick. */}
      <SheetContent side="right" className="data-[side=right]:w-96 max-w-[90vw] flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border p-0">
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="text-base">Queue</SheetTitle>
        </SheetHeader>

        <div ref={scrollerMounted} data-testid="queue-scroller" className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
          <div className="flex flex-col gap-3">
            {history.length > 0 && (
              <section data-testid="played">
                <div className={SECTION_LABEL}>Played · {history.length}</div>
                <div className="flex flex-col">
                  {history.map((t, i) => (
                    <div key={`${t.id}-${i}`} data-testid="played-row">
                      <TrackRow
                        track={t}
                        density="compact"
                        tone="sidebar"
                        showDuration
                        artworkFallback={null}
                        artworkSrc={artworkSrcFor(t)}
                        className="opacity-50 hover:opacity-100 focus-within:opacity-100 hover:bg-sidebar-accent/60"
                        // Back through the history, as Previous pressed that
                        // many times: the queue stays, the songs after it
                        // are still ahead.
                        onPlay={() => playBack(history.length - i)}
                        trailingPlayControl
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div ref={anchorRef} data-testid="now-anchor" className="-mb-3 h-0" aria-hidden />

            <CouldntPlaySection entries={failed} artworkSrcFor={artworkSrcFor} labelClassName={SECTION_LABEL} />

            {current && (
              <div data-testid="now-playing" className="rounded-xl bg-sidebar-accent px-inset pt-cluster pb-row ring-1 ring-ember/30">
                <div className="px-row text-[11px] uppercase tracking-widest text-ember">Now playing</div>
                {/* No onPlay: the current row is a label, not a control. */}
                <TrackRow
                  track={current}
                  density="compact"
                  tone="sidebar"
                  showDuration
                  active
                  unavailable={isUnavailable(current)}
                  artworkFallback={null}
                  artworkSrc={artworkSrcFor(current)}
                  className="hover:bg-transparent"
                />
                <NowProgress />
              </div>
            )}

            {upcoming.length > 0 && (
              <div>
                <div className={SECTION_LABEL}>Next up · {upcoming.length}</div>
                <div className="flex flex-col">
                  {upcoming.map((t, i) => (
                    <TrackRow
                      key={`${t.id}-${index + 1 + i}`}
                      track={t}
                      density="compact"
                      tone="sidebar"
                      showDuration
                      // Greyed with its reason, not dropped: a song that could
                      // not play stays where it was, and says why.
                      unavailable={isUnavailable(t)}
                      artworkFallback={null}
                      artworkSrc={artworkSrcFor(t)}
                      className={cn('hover:bg-sidebar-accent/60', outOfReach(t) && 'opacity-50')}
                      // A jump inside the queue, not a new queue: playTrack
                      // would collapse a search-started queue to one song,
                      // turn shuffle off and move the loop point.
                      onPlay={() => playAt(index + 1 + i)}
                      // A real Play button too: the row's own click is a
                      // mouse-only handler on a div that Tab never reaches.
                      trailingPlayControl
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
          <div ref={spacerRef} aria-hidden />
        </div>
      </SheetContent>
    </Sheet>
  );
}
