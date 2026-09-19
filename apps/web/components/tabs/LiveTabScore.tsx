'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';
import { dragReducer, edgeScrollSpeed, idleDrag, isActive, snapToBeat, type DragEvent, type Snap } from '@/lib/tabDrag';
import { logger } from '@/lib/logger/client';
import { displaySettings, scoreInfo, type ScoreInfo, type TabsScroll, type TabsStaff } from '@/lib/tabScore';
import {
  beatToSongSec,
  estimateSongSec,
  FEED_INTERVAL_MS,
  followScroll,
  songToTabMs,
  type Anchor,
  type Box,
} from '@/lib/tabSync';

// alphaTab ships no types we can reach through a dynamic import without
// pulling its whole surface in; the members used here are named below.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface LiveTabScoreProps {
  /** Where to fetch the Guitar Pro / MusicXML / alphaTex file. */
  url: string;
  staff: TabsStaff;
  scroll: TabsScroll;
  /** Index into the score's tracks. */
  track: number;
  scale: number;
  /** The tab's sync nudge in ms (positive: the tab runs ahead). */
  offsetMs: number;
  /** This tab's song is the one Ember is playing, so the cursor follows it
   *  and a click seeks it. False: the score is drawn, nothing moves. */
  follows: boolean;
  playing: boolean;
  /** Ember's playhead, seconds. */
  position: number;
  /** Ember's track length, seconds. */
  duration: number;
  onSeek: (sec: number) => void;
  onScore?: (info: ScoreInfo) => void;
  /** The element that scrolls the page vertically (the app's content
   *  scroller) and how much of its top the sticky toolbar covers. */
  getPageScroller?: () => HTMLElement | null;
  getTopInset?: () => number;
  className?: string;
}

/** A tab drawn by AlphaTab, its cursor walking in time with the song Ember
 *  is playing (docs/tabs-rebuild.md section 4).
 *
 *  AlphaTab ships a synthesizer, and it is not used: Ember plays the real
 *  recording. The score is loaded in `EnabledExternalMedia` mode, where
 *  AlphaTab draws and moves the cursor while something else owns the time
 *  axis, and Ember's playhead is fed to it every 50 ms (between the
 *  player's own reports the wall clock carries it on).
 *
 *  Nothing AlphaTab does moves the song on its own: the media handler it
 *  talks to is inert, and its built-in click handling is off. A click on a
 *  beat seeks the song exactly once, through `beatMouseDown`, to where
 *  that beat sounds (lib/tabSync.ts beatToSongSec).
 *
 *  The line itself can be grabbed (lib/tabDrag.ts): a hit area rides on
 *  AlphaTab's cursor, a drag shows a ghost line snapped to the nearest beat
 *  with its time, and letting go seeks there, once. With the score focused,
 *  Left and Right move the line by one beat. */
export function LiveTabScore(props: LiveTabScoreProps) {
  const { url, staff, scroll, track, scale, className } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const outputRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  // Handlers AlphaTab calls are installed once; they read the latest props.
  const live = useRef(props);
  useLayoutEffect(() => {
    live.current = props;
  });
  const anchor = useRef<Anchor>({ sec: props.position, at: 0 });
  /** Where the score ends on the tab clock (ms), from AlphaTab. */
  const endMs = useRef(Infinity);

  // ── dragging the line (lib/tabDrag.ts) ──────────────────────────────────
  const hitRef = useRef<HTMLDivElement>(null);
  const drag = useRef(idleDrag);
  const snap = useRef<Snap | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; h: number; label: string; flip: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Bring the playing beat back into view (set once AlphaTab is up). */
  const refollow = useRef<() => void>(() => {});

  // ── build AlphaTab once per file ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let api: any = null;
    let observer: ResizeObserver | null = null;
    let settled = false;
    let lastBeat: any = null;
    // A file that passed the upload sniff and is still malformed can leave
    // AlphaTab with neither event: cap the wait.
    const timer = setTimeout(() => {
      if (!cancelled && !settled) {
        setError('That file could not be drawn.');
        setStatus('error');
      }
    }, 20_000);

    (async () => {
      try {
        const [at, res]: [any, Response] = await Promise.all([
          import('@coderline/alphatab'),
          fetch(url, { credentials: 'same-origin' }),
        ]);
        if (!res.ok) throw new Error(`Could not load that tab (${res.status}).`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const host = hostRef.current;
        if (cancelled || !host) return;
        // AlphaTab measures its container once, at construction: wait for
        // a real width, or it lays the score out to zero.
        for (let i = 0; i < 240 && host.clientWidth === 0 && !cancelled; i++) {
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        if (cancelled) return;
        if (host.clientWidth === 0) throw new Error('The tab never got a size to draw into.');

        const p = live.current;
        const look = displaySettings(at, { staff: p.staff, scroll: p.scroll, scale: p.scale });
        api = new at.AlphaTabApi(host, {
          core: {
            engine: 'svg',
            fontDirectory: '/alphatab/font/',
            // Main thread: the worker's script URL cannot be derived when
            // AlphaTab comes through the bundler, and it renders 0x0.
            useWorkers: false,
          },
          ...look,
          player: {
            enablePlayer: true,
            playerMode: at.PlayerMode.EnabledExternalMedia,
            enableCursor: true,
            enableAnimatedBeatCursor: true,
            // Clicks are ours (beatMouseDown below), and so is scrolling
            // (followScroll): AlphaTab would seek and scroll on its own.
            enableUserInteraction: false,
            scrollMode: at.ScrollMode.Off,
          },
        });
        apiRef.current = api;

        api.scoreLoaded.on((score: any) => {
          if (cancelled) return;
          live.current.onScore?.(scoreInfo(score));
        });
        api.postRenderFinished.on(() => {
          if (cancelled) return;
          settled = true;
          setStatus('ready');
          // A new layout (Horizontal, a resize) moved everything: find the
          // playing beat again.
          if (lastBeat) followBeat(lastBeat);
        });
        api.error.on((e: any) => {
          settled = true;
          if (cancelled) return;
          setError(String(e?.message || 'AlphaTab could not read that file.'));
          setStatus('error');
        });

        // Ember owns the transport. AlphaTab calls play/pause/seek as part
        // of its own lifecycle (wiring itself up, reaching the end of the
        // score); forwarding those would pause or rewind the listener's
        // music, so the handler it talks to does nothing.
        const installHandler = () => {
          const output = api.player?.output;
          if (!output || cancelled) return;
          outputRef.current = output;
          output.handler = {
            get backingTrackDuration() {
              return Math.max(0, live.current.duration) * 1000 + Math.max(0, live.current.offsetMs);
            },
            playbackRate: 1,
            masterVolume: 1,
            play: () => {},
            pause: () => {},
            seekTo: () => {},
          };
          setSynced(true);
        };
        api.playerReady.on(installHandler);
        installHandler(); // in case the player was ready before we subscribed

        api.playerPositionChanged.on((e: any) => {
          if (typeof e?.endTime === 'number' && e.endTime > 0) endMs.current = e.endTime;
        });

        // Click a beat: seek the song there. The one path from the score to
        // the player.
        api.beatMouseDown.on((beat: any) => {
          const p2 = live.current;
          if (!p2.follows || !api.tickCache || !beat) return;
          try {
            p2.onSeek(beatToSongSec(api.tickCache, beat, p2.offsetMs));
          } catch {
            // A beat AlphaTab cannot place is not worth breaking playback.
          }
        });

        // Keep the playing bar in view.
        api.playedBeatChanged.on((beat: any) => {
          lastBeat = beat;
          followBeat(beat);
        });

        api.load(bytes, [live.current.track]);

        // Re-lay out when the column changes width (window resize, the
        // lyrics panel opening).
        let lastWidth = host.clientWidth;
        observer = new ResizeObserver(() => {
          const w = host.clientWidth;
          if (w > 0 && Math.abs(w - lastWidth) > 8) {
            lastWidth = w;
            try {
              api.render();
            } catch {
              // A failed re-render leaves the previous one on screen.
            }
          }
        });
        observer.observe(host);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not open that tab.');
          setStatus('error');
        }
      }
    })();

    refollow.current = () => {
      if (lastBeat) followBeat(lastBeat);
    };

    function followBeat(beat: any) {
      const bounds = api?.renderer?.boundsLookup?.findBeat?.(beat);
      const bar = bounds?.barBounds?.masterBarBounds?.visualBounds;
      const b = bounds?.visualBounds;
      if (bar) keepInView(bar, b ?? bar);
    }

    /** Scroll the page (vertical) or the row (horizontal) so the playing
     *  bar or beat is in the band lib/tabSync.ts followScroll keeps it in. */
    function keepInView(bar: Box, beat: Box) {
      // Hands off while the line is held: the listener is steering.
      if (isActive(drag.current)) return;
      const host = hostRef.current;
      const mode = live.current.scroll;
      const scroller = mode === 'horizontal' ? scrollerRef.current : live.current.getPageScroller?.();
      if (!host || !scroller) return;
      const hostBox = host.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const toContent = (r: Box): Box => ({
        x: r.x + hostBox.left - box.left + scroller.scrollLeft,
        y: r.y + hostBox.top - box.top + scroller.scrollTop,
        w: r.w,
        h: r.h,
      });
      const target = followScroll(mode, toContent(bar), {
        scrollTop: scroller.scrollTop,
        scrollLeft: scroller.scrollLeft,
        width: scroller.clientWidth,
        height: scroller.clientHeight,
        topInset: mode === 'vertical' ? (live.current.getTopInset?.() ?? 0) : 0,
      }, toContent(beat));
      if (target) scroller.scrollTo({ ...target, behavior: 'smooth' });
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      observer?.disconnect();
      try {
        api?.destroy();
      } catch {
        // A half-initialised AlphaTab can throw on destroy; it is going anyway.
      }
      apiRef.current = null;
      outputRef.current = null;
      refollow.current = () => {};
      endMs.current = Infinity;
      setSynced(false);
    };
  }, [url]);

  // ── look: notation, layout, scale ───────────────────────────────────────
  const firstLook = useRef(true);
  useEffect(() => {
    if (firstLook.current) {
      firstLook.current = false;
      return;
    }
    const api = apiRef.current;
    if (!api) return;
    (async () => {
      const at: any = await import('@coderline/alphatab');
      // Only the fields that change. `resources` is left alone: AlphaTab
      // keeps a RenderingResources instance there, and a plain object in
      // its place makes the next render throw.
      const { display } = displaySettings(at, { staff, scroll, scale });
      api.settings.display.scale = display.scale;
      api.settings.display.staveProfile = display.staveProfile;
      api.settings.display.layoutMode = display.layoutMode;
      try {
        api.updateSettings();
        api.render();
      } catch (e) {
        // Keep the previous drawing, but say so: a silent failure here once
        // hid a toggle that did nothing.
        logger.error('tabs', 'tab re-layout failed', { staff, scroll }, e as Error);
      }
      // A new layout starts at the left.
      if (scrollerRef.current) scrollerRef.current.scrollLeft = 0;
    })();
  }, [staff, scroll, scale]);

  // ── the instrument shown ────────────────────────────────────────────────
  useEffect(() => {
    const api = apiRef.current;
    const t = api?.score?.tracks?.[track];
    // The first drawing already shows the chosen track (api.load above).
    if (t && api.tracks?.[0] !== t) api.renderTracks([t]);
  }, [track, status]);

  // ── transport: mirror Ember into AlphaTab ───────────────────────────────
  // Its cursor only animates while it believes playback runs, so a score
  // left stopped sits still whatever position it is fed.
  const { follows, playing, position } = props;
  useEffect(() => {
    anchor.current = { sec: position, at: performance.now() };
  }, [position]);

  useEffect(() => {
    // Paused and resumed from here: the estimate restarts from the last
    // report rather than jumping by the time spent paused.
    anchor.current = { sec: live.current.position, at: performance.now() };
    const api = apiRef.current;
    if (!api || !synced) return;
    try {
      if (follows && playing) api.play();
      else api.pause();
    } catch {
      // Mirroring the transport must never break playback.
    }
  }, [follows, playing, synced]);

  // ── feed the playhead every 50 ms ───────────────────────────────────────
  useEffect(() => {
    if (!follows || !synced) return;
    let raf = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < FEED_INTERVAL_MS) return;
      last = now;
      const p = live.current;
      const output = outputRef.current;
      const api = apiRef.current;
      if (!output || !api) return;
      const tabMs = songToTabMs(estimateSongSec(anchor.current, now, p.playing), p.offsetMs);
      try {
        output.updatePosition(tabMs);
        // Past the last bar AlphaTab stops itself; after a seek back into
        // the score it has to be told to run again.
        if (p.playing && api.playerState !== 1 && tabMs < endMs.current - 200) api.play();
      } catch {
        // A cursor that cannot move must never break playback.
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [follows, synced]);

  // ── the line's hit area rides on AlphaTab's cursor ───────────────────────
  // AlphaTab moves its cursor with CSS transitions, so its box is read every
  // frame and the (invisible) hit area is laid over it.
  const ready = status === 'ready';
  useEffect(() => {
    if (!follows || !ready) return;
    let raf = 0;
    let last = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const hit = hitRef.current;
      const host = hostRef.current;
      const cursor = host?.querySelector('.at-cursor-beat');
      if (!hit || !host) return;
      const r = cursor?.getBoundingClientRect();
      const h = hostBoxOf(host);
      const next =
        r && r.height > 0 ? `${r.left + r.width / 2 - h.left}px|${r.top - h.top}px|${r.height}px` : 'none';
      if (next === last) return;
      last = next;
      if (next === 'none') {
        hit.style.display = 'none';
        return;
      }
      const [left, top, height] = next.split('|');
      hit.style.display = '';
      hit.style.left = left;
      hit.style.top = top;
      hit.style.height = height;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // The handle is going (another song, a failed redraw): drop any drag
      // on it, so follow-scroll is not left paused.
      if (isActive(drag.current)) {
        drag.current = idleDrag;
        snap.current = null;
        setGhost(null);
        setDragging(false);
      }
    };
  }, [follows, ready]);

  /** Where a beat sounds in the song, or null if AlphaTab cannot place it. */
  const beatSec = (beat: unknown): number | null => {
    const api = apiRef.current;
    if (!api?.tickCache || !beat) return null;
    try {
      return beatToSongSec(api.tickCache, beat as never, live.current.offsetMs);
    } catch {
      return null;
    }
  };

  /** The beat nearest a client point, with the ghost line's box and time. */
  const snapAt = (clientX: number, clientY: number) => {
    const host = hostRef.current;
    const lookup = apiRef.current?.renderer?.boundsLookup;
    if (!host || !lookup) return;
    const h = hostBoxOf(host);
    const s = snapToBeat(lookup, clientX - h.left, clientY - h.top);
    const sec = s ? beatSec(s.beat) : null;
    if (!s || sec === null) return;
    snap.current = s;
    const label = formatTime(sec, { empty: '0:00' });
    // Near the right edge the time sits on the line's left instead.
    const flip = s.x > host.clientWidth - 64;
    setGhost((g) =>
      g && g.x === s.x && g.y === s.y && g.h === s.h && g.label === label && g.flip === flip
        ? g
        : { x: s.x, y: s.y, h: s.h, label, flip },
    );
  };

  const seekTo = (beat: unknown) => {
    const sec = beatSec(beat);
    if (sec !== null && live.current.follows) live.current.onSeek(sec);
  };

  const send = (e: DragEvent) => {
    const prev = drag.current;
    const next = dragReducer(prev, e);
    drag.current = next;
    if (next.phase === 'dragging') {
      if (prev.phase !== 'dragging') setDragging(true);
      snapAt(next.x, next.y);
      return;
    }
    if (next.phase === 'released') {
      if (prev.phase === 'dragging') {
        if (snap.current) seekTo(snap.current.beat);
      } else {
        // Never moved: a click, which seeks where AlphaTab's own click would.
        const host = hostRef.current;
        const lookup = apiRef.current?.renderer?.boundsLookup;
        if (host && lookup) {
          const h = hostBoxOf(host);
          seekTo(lookup.getBeatAtPos?.(next.startX - h.left, next.startY - h.top));
        }
      }
    }
    if (next.phase === 'released' || next.phase === 'cancelled') {
      const wasCancelled = next.phase === 'cancelled';
      drag.current = idleDrag;
      snap.current = null;
      setGhost(null);
      setDragging(false);
      // A cancelled drag may have scrolled away from the line: go back.
      if (wasCancelled && live.current.playing) refollow.current();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!follows || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // No text selection, no compatibility mousedown for AlphaTab.
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every environment can capture; moves still arrive while over it.
    }
    send({ type: 'down', pointerId: e.pointerId, x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (isActive(drag.current)) send({ type: 'move', pointerId: e.pointerId, x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (isActive(drag.current)) send({ type: 'up', pointerId: e.pointerId });
  };
  const onPointerCancel = () => {
    if (isActive(drag.current)) send({ type: 'cancel' });
  };

  // Escape drops a drag with no seek.
  const active = dragging || ghost !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      const id = drag.current.pointerId;
      send({ type: 'cancel' });
      try {
        if (id !== null) hitRef.current?.releasePointerCapture(id);
      } catch {
        // Already released.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // send reads refs only; the listener lives exactly as long as the drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  // Near an edge of the visible score, scroll so the drag can go further.
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = live.current;
      const d = drag.current;
      if (d.phase !== 'dragging') return;
      const horizontal = p.scroll === 'horizontal';
      const scroller = horizontal ? scrollerRef.current : p.getPageScroller?.();
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const speed = horizontal
        ? edgeScrollSpeed(d.x, box.left, box.right)
        : edgeScrollSpeed(d.y, box.top + (p.getTopInset?.() ?? 0), Math.min(box.bottom, window.innerHeight));
      if (!speed) return;
      if (horizontal) scroller.scrollLeft += speed;
      else scroller.scrollTop += speed;
      snapAt(d.x, d.y);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  // ── keyboard: Left and Right move the line by one beat ──────────────────
  const keyTarget = useRef<{ beat: unknown; at: number } | null>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!follows || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const api = apiRef.current;
    if (!api?.tickCache) return;
    // Presses quicker than the player reports its new position step on
    // from the last target rather than from a stale playhead.
    const now = performance.now();
    let beat: any = keyTarget.current && now - keyTarget.current.at < 600 ? keyTarget.current.beat : null;
    if (!beat) {
      try {
        const tracks = new Set<number>((api.tracks ?? []).map((t: any) => t.index));
        // A few ticks in, so a playhead sitting exactly on a beat (after a
        // seek there) is not rounded down into the one before.
        beat = api.tickCache.findBeat(tracks, (api.tickPosition ?? 0) + 10)?.beat ?? null;
      } catch {
        beat = null;
      }
    }
    if (!beat) return;
    const target = e.key === 'ArrowRight' ? beat.nextBeat : beat.previousBeat;
    // The score's own arrow keys win over the player's 5 s jumps.
    e.preventDefault();
    e.stopPropagation();
    if (!target) return;
    keyTarget.current = { beat: target, at: now };
    seekTo(target);
  };

  return (
    <div
      ref={scrollerRef}
      data-testid="tab-score"
      data-status={status}
      data-scroll={scroll}
      data-staff={staff}
      data-track={track}
      data-dragging={active || undefined}
      tabIndex={follows ? 0 : undefined}
      aria-label={follows ? 'Tab. Drag the line to move through the song; Left and Right move it by a beat.' : undefined}
      onKeyDown={onKeyDown}
      className={cn(
        'relative isolate min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ember/40',
        scroll === 'horizontal' && 'overflow-x-auto overflow-y-hidden',
        !follows && '[&_.at-cursor-beat]:hidden [&_.at-cursor-bar]:hidden',
        className,
      )}
    >
      <div ref={hostRef} className="w-full" />
      {follows && ready && (
        <div
          ref={hitRef}
          data-testid="tab-line-handle"
          aria-hidden
          className="tab-line-handle"
          style={{ display: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onPointerCancel}
        />
      )}
      {ghost && (
        <>
          <div
            data-testid="tab-line-ghost"
            className="tab-line-ghost"
            style={{ left: ghost.x, top: ghost.y, height: ghost.h }}
          />
          <div
            data-testid="tab-line-time"
            data-flip={ghost.flip || undefined}
            className="tab-line-time rounded-md bg-card px-cluster py-inset text-xs font-medium tabular-nums text-ember shadow-sm"
            style={{ left: ghost.x, top: ghost.y }}
          >
            {ghost.label}
          </div>
        </>
      )}
      {status === 'loading' && <div className="text-meta py-block">Drawing the tab…</div>}
      {status === 'error' && (
        <div role="alert" className="text-meta py-block">
          {error ?? 'That file could not be drawn.'}
        </div>
      )}
    </div>
  );
}

/** The host's box in the viewport: bounds from AlphaTab are relative to it. */
function hostBoxOf(host: HTMLElement): { left: number; top: number } {
  const r = host.getBoundingClientRect();
  return { left: r.left, top: r.top };
}
