'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
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
 *  that beat sounds (lib/tabSync.ts beatToSongSec). */
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

  // ── build AlphaTab once per file ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let api: any = null;
    let observer: ResizeObserver | null = null;
    let settled = false;
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
          const bounds = api.renderer?.boundsLookup?.findBeat?.(beat);
          const bar = bounds?.barBounds?.masterBarBounds?.visualBounds;
          if (bar) keepInView({ x: bar.x, y: bar.y, w: bar.w, h: bar.h });
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

    /** Scroll the page (vertical) or the row (horizontal) so the bar is in
     *  the band lib/tabSync.ts followScroll keeps it in. */
    function keepInView(bar: Box) {
      const host = hostRef.current;
      const mode = live.current.scroll;
      const scroller = mode === 'horizontal' ? scrollerRef.current : live.current.getPageScroller?.();
      if (!host || !scroller) return;
      const hostBox = host.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const inContent: Box = {
        x: bar.x + hostBox.left - box.left + scroller.scrollLeft,
        y: bar.y + hostBox.top - box.top + scroller.scrollTop,
        w: bar.w,
        h: bar.h,
      };
      const target = followScroll(mode, inContent, {
        scrollTop: scroller.scrollTop,
        scrollLeft: scroller.scrollLeft,
        width: scroller.clientWidth,
        height: scroller.clientHeight,
        topInset: mode === 'vertical' ? (live.current.getTopInset?.() ?? 0) : 0,
      });
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
      const look = displaySettings(at, { staff, scroll, scale });
      Object.assign(api.settings.display, look.display);
      Object.assign(api.settings.notation, look.notation);
      try {
        api.updateSettings();
        api.render();
      } catch {
        // Keep the previous drawing.
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

  return (
    <div
      ref={scrollerRef}
      data-testid="tab-score"
      data-status={status}
      data-scroll={scroll}
      data-staff={staff}
      data-track={track}
      className={cn(
        'relative min-w-0',
        scroll === 'horizontal' && 'overflow-x-auto overflow-y-hidden',
        !follows && '[&_.at-cursor-beat]:hidden [&_.at-cursor-bar]:hidden',
        className,
      )}
    >
      <div ref={hostRef} className="w-full" />
      {status === 'loading' && <div className="text-meta py-block">Drawing the tab…</div>}
      {status === 'error' && (
        <div role="alert" className="text-meta py-block">
          {error ?? 'That file could not be drawn.'}
        </div>
      )}
    </div>
  );
}
