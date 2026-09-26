'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format';
import { dragReducer, edgeScrollSpeed, idleDrag, isActive, snapToBeat, type DragEvent, type Snap } from '@/lib/tabDrag';
import { logger } from '@/lib/logger/client';
import { buildTimeline, type TabTimeline } from '@/lib/tabTimeline';
import type { BarRange } from '@/lib/tabPractice';
import {
  displaySettings,
  scoreInfo,
  staveProfileOf,
  trackIndexIn,
  type ScoreInfo,
  type TabsScroll,
  type TabsStaff,
} from '@/lib/tabScore';
import {
  barStartsMs,
  beatToSongSec,
  estimateSongSec,
  FEED_INTERVAL_MS,
  followScroll,
  isJump,
  songSecToTabMs,
  syncPoints,
  type Anchor,
  type Box,
  type Fed,
  type SyncPoint,
  type TabTiming,
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
  /** Where the tab sits in the recording (align.py, lib/tabSync.ts), when
   *  it has been lined up confidently. Null: the tab's own clock starts at
   *  the song's start, as before. */
  timing?: TabTiming | null;
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
  /** The tab's bars, signatures, sections and tempo map on its own clock
   *  (lib/tabTimeline.ts), once AlphaTab has worked them out: the practice
   *  tools (metronome, loop) are built on it. */
  onTimeline?: (timeline: TabTimeline) => void;
  /** Playback speed (1: as recorded). The playhead between the player's
   *  reports runs on at this speed, and AlphaTab animates the line at it. */
  rate?: number;
  /** Bars to mark on the score (the practice loop), by score bar index. */
  highlight?: BarRange | null;
  /** While set, a click on the score picks the bar it landed on (choosing
   *  a loop) instead of seeking. */
  onBarPick?: ((bar: number) => void) | null;
  /** The element that scrolls the page vertically (the app's content
   *  scroller) and how much of its top the sticky toolbar covers. */
  getPageScroller?: () => HTMLElement | null;
  getTopInset?: () => number;
  className?: string;
}

/** A tab drawn by AlphaTab, its cursor walking in time with the song Ember
 *  is playing.
 *
 *  AlphaTab ships a synthesizer, and it is not used: Ember plays the real
 *  recording. The score is loaded in `EnabledExternalMedia` mode, where
 *  AlphaTab draws and moves the cursor while something else owns the time
 *  axis, and Ember's playhead is fed to it every 50 ms (between the
 *  player's own reports the wall clock carries it on). A position that is
 *  not where playback would have got to (a seek, the sync nudge, a fresh
 *  layout) goes to AlphaTab as a seek, so the line jumps there rather than
 *  sliding over, and is brought into view even while paused.
 *
 *  A tab lined up with the recording is fed
 *  through its bar anchors instead: song time to tab time piecewise over
 *  them (lib/tabSync.ts songSecToTabMs), the nudge still on top, and every
 *  seek (a click, a drag, the arrow keys) back the same way.
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
  /** The AlphaTab module, kept once it is imported. */
  const atRef = useRef<any>(null);
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
  /** Bring the beat at AlphaTab's playhead into view, playing or not. */
  const followPlayhead = useRef<() => void>(() => {});
  /** Read the bar anchors again (a new score, a fresh alignment). */
  const readAnchorsRef = useRef<() => void>(() => {});
  /** Mark the practice loop's bars on the score (or clear the mark). */
  const highlightRef = useRef<() => void>(() => {});
  /** The last position fed to AlphaTab; null makes the next feed a seek. */
  const fed = useRef<Fed | null>(null);
  /** Song time against tab time at every bar, from the alignment and
   *  AlphaTab's own tick lookup. Empty when the tab is not lined up. */
  const points = useRef<SyncPoint[]>([]);
  /** What the loaded file holds, read before AlphaTab is built: the index
   *  asked for is clamped to it and the stave profile follows it. Null
   *  until the score is in hand. */
  const loaded = useRef<ScoreInfo | null>(null);
  /** The instrument on screen has a tablature staff, so "Tab" can be drawn
   *  on its own (lib/tabScore.ts staveProfileOf). */
  const hasTab = (index: number) => loaded.current?.tracks[index]?.tab ?? true;

  // ── build AlphaTab once per file ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let api: any = null;
    let observer: ResizeObserver | null = null;
    let relayout = 0;
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

        // Read the file before AlphaTab is built, not after: the score says
        // which instruments exist and whether they carry tablature, and both
        // have to be right at the first drawing. Handed a track it cannot
        // resolve, or asked for "Tab" on a score with no tablature staff,
        // AlphaTab lays out an empty system and throws instead of drawing.
        atRef.current = at;
        const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
        const info = scoreInfo(score);
        if (info.tracks.length === 0) throw new Error('That tab has no instrument to draw.');
        loaded.current = info;
        const index = trackIndexIn(info.tracks.length, live.current.track);

        const p = live.current;
        const look = displaySettings(at, {
          staff: p.staff,
          scroll: p.scroll,
          scale: p.scale,
          hasTab: info.tracks[index]?.tab ?? true,
        });
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
          // playing beat again, and place the line afresh on the next feed.
          fed.current = null;
          if (lastBeat) followBeat(lastBeat, !live.current.playing);
          // A new layout drew the score afresh: mark the loop on it again.
          highlightRef.current();
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
              const p = live.current;
              return songSecToTabMs(Math.max(0, p.duration), points.current, Math.max(0, p.offsetMs));
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

        // Loading the score rewinds AlphaTab to the top: place the line
        // again, and read the bars' own clock for the alignment's anchors.
        api.midiLoaded?.on?.(() => {
          fed.current = null;
          readAnchors();
          emitTimeline();
        });

        api.playerPositionChanged.on((e: any) => {
          if (typeof e?.endTime === 'number' && e.endTime > 0) endMs.current = e.endTime;
        });

        // Click a beat: seek the song there. The one path from the score to
        // the player.
        api.beatMouseDown.on((beat: any) => {
          const p2 = live.current;
          if (p2.onBarPick && beat) {
            const bar = barIndexOf(beat);
            if (bar !== null) p2.onBarPick(bar);
            return;
          }
          if (!p2.follows || !api.tickCache || !beat) return;
          try {
            p2.onSeek(beatToSongSec(api.tickCache, beat, p2.offsetMs, points.current));
          } catch {
            // A beat AlphaTab cannot place is not worth breaking playback.
          }
        });

        // Keep the playing bar in view.
        api.playedBeatChanged.on((beat: any) => {
          lastBeat = beat;
          followBeat(beat);
        });

        api.renderScore(score, [index]);

        // Re-lay out when the column changes width (window resize, the
        // lyrics panel opening). In the next frame, not in the callback: a
        // re-draw changes the host's size while the browser is still handing
        // out size changes (AlphaTab observes the same element), and the
        // browser answers that with "ResizeObserver loop completed with
        // undelivered notifications", which went out as a bug report.
        let lastWidth = host.clientWidth;
        observer = new ResizeObserver(() => {
          const w = host.clientWidth;
          if (w > 0 && Math.abs(w - lastWidth) > 8) {
            lastWidth = w;
            cancelAnimationFrame(relayout);
            relayout = requestAnimationFrame(() => {
              if (cancelled) return;
              try {
                api.render();
              } catch {
                // A failed re-render leaves the previous one on screen.
              }
            });
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
    highlightRef.current = () => {
      const a = apiRef.current;
      if (!a || cancelled) return;
      const h = live.current.highlight ?? null;
      try {
        if (!h) {
          a.clearPlaybackRangeHighlight?.();
          return;
        }
        const bars: any[] = a.tracks?.[0]?.staves?.[0]?.bars ?? [];
        const first = bars[h.start]?.voices?.[0]?.beats?.[0];
        const lastBeats: any[] = bars[h.end]?.voices?.[0]?.beats ?? [];
        const last = lastBeats[lastBeats.length - 1];
        if (first && last) a.highlightPlaybackRange?.(first, last);
      } catch {
        // An unmarked loop still loops.
      }
    };
    followPlayhead.current = () => {
      try {
        const tracks = new Set<number>((api?.tracks ?? []).map((t: any) => t.index));
        const beat = api?.tickCache?.findBeat?.(tracks, api.tickPosition ?? 0)?.beat;
        if (!beat) return;
        lastBeat = beat;
        // Paused, only a line off screen is brought back: a click on a beat
        // must not move the page under the pointer. After a seek the view
        // goes straight there; a smooth scroll across the score left the
        // line off screen for most of a second.
        followBeat(beat, !live.current.playing, true);
      } catch {
        // Not finding the beat only means not scrolling to it.
      }
    };

    function readAnchors() {
      const bars = apiRef.current?.tickCache?.masterBars;
      const timing = live.current.timing ?? null;
      points.current = timing && bars ? syncPoints(timing, barStartsMs(bars)) : [];
    }
    readAnchorsRef.current = readAnchors;

    function emitTimeline() {
      const bars = apiRef.current?.tickCache?.masterBars;
      if (cancelled || !Array.isArray(bars) || bars.length === 0) return;
      try {
        live.current.onTimeline?.(buildTimeline(bars));
      } catch {
        // No timeline only means no practice tools for this file.
      }
    }

    function followBeat(beat: any, hiddenOnly = false, instant = false) {
      const bounds = api?.renderer?.boundsLookup?.findBeat?.(beat);
      const bar = bounds?.barBounds?.masterBarBounds?.visualBounds;
      const b = bounds?.visualBounds;
      if (bar) keepInView(bar, b ?? bar, hiddenOnly, instant);
    }

    /** Scroll the page (vertical) or the row (horizontal) so the playing
     *  bar or beat is in the band lib/tabSync.ts followScroll keeps it in
     *  (or, `hiddenOnly`, just on screen). */
    function keepInView(bar: Box, beat: Box, hiddenOnly = false, instant = false) {
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
      }, toContent(beat), { hiddenOnly });
      if (target) scroller.scrollTo({ ...target, behavior: instant ? 'instant' : 'smooth' });
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(relayout);
      observer?.disconnect();
      try {
        api?.destroy();
      } catch {
        // A half-initialised AlphaTab can throw on destroy; it is going anyway.
      }
      apiRef.current = null;
      outputRef.current = null;
      loaded.current = null;
      points.current = [];
      refollow.current = () => {};
      followPlayhead.current = () => {};
      highlightRef.current = () => {};
      fed.current = null;
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
      const { display } = displaySettings(at, {
        staff,
        scroll,
        scale,
        hasTab: hasTab(trackIndexIn(loaded.current?.tracks.length ?? 0, live.current.track)),
      });
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

  // ── the alignment ───────────────────────────────────────────────────────
  // A job that finished while the page was open (or a tab that was lined up
  // before) changes where the cursor goes: read the anchors again and place
  // the line afresh on the next feed.
  const { timing } = props;
  useEffect(() => {
    readAnchorsRef.current();
    fed.current = null;
  }, [timing, status]);

  // ── the instrument shown ────────────────────────────────────────────────
  useEffect(() => {
    const api = apiRef.current;
    const at = atRef.current;
    const count = api?.score?.tracks?.length ?? 0;
    if (!count) return;
    // The picker's list can be a score behind (another tab is loading), so
    // the index is clamped to the score actually in hand.
    const index = trackIndexIn(count, track);
    const t = api.score.tracks[index];
    // The first drawing already shows the chosen track (api.renderScore above).
    if (!t || api.tracks?.[0] === t) return;
    // This instrument may be score-only where the last one had tablature.
    if (at) api.settings.display.staveProfile = staveProfileOf(at, live.current.staff, hasTab(index));
    api.renderTracks([t]);
  }, [track, status]);

  // ── practice: the loop's mark and the speed ─────────────────────────────
  const hlStart = props.highlight?.start ?? null;
  const hlEnd = props.highlight?.end ?? null;
  useEffect(() => {
    highlightRef.current();
  }, [hlStart, hlEnd, track, status]);

  const rate = props.rate ?? 1;
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !synced) return;
    try {
      // AlphaTab times its line's glide between beats by this; the handler
      // it forwards the speed to is inert (Ember's player owns the speed).
      api.playbackSpeed = rate;
    } catch {
      // A line that glides at the wrong speed still lands on the beat.
    }
  }, [rate, synced]);

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
      const tabMs = songSecToTabMs(estimateSongSec(anchor.current, now, p.playing, p.rate ?? 1), points.current, p.offsetMs);
      try {
        if (!api.isReadyForPlayback) {
          // No score in the player yet: it cannot seek, and whatever it
          // shows now is placed again once it can.
          output.updatePosition(tabMs);
          fed.current = null;
        } else if (isJump(fed.current, tabMs, now, p.playing)) {
          // Fed as playback, AlphaTab would animate its line from where it
          // was towards here over a beat or two; as a seek it jumps.
          api.timePosition = tabMs;
          fed.current = { ms: tabMs, at: now };
          followPlayhead.current();
        } else {
          output.updatePosition(tabMs);
          fed.current = { ms: tabMs, at: now };
        }
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
      return beatToSongSec(api.tickCache, beat as never, live.current.offsetMs, points.current);
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
    // Choosing a loop: the click picks the bar instead.
    const pick = live.current.onBarPick;
    if (pick) {
      const bar = barIndexOf(beat);
      if (bar !== null) pick(bar);
      return;
    }
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

/** The score bar a beat is in (0-based), or null. */
function barIndexOf(beat: any): number | null {
  const bar = beat?.voice?.bar;
  const i = typeof bar?.index === 'number' ? bar.index : bar?.masterBar?.index;
  return typeof i === 'number' && i >= 0 ? i : null;
}

/** The host's box in the viewport: bounds from AlphaTab are relative to it. */
function hostBoxOf(host: HTMLElement): { left: number; top: number } {
  const r = host.getBoundingClientRect();
  return { left: r.left, top: r.top };
}
