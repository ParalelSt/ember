'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { TabsScroll, TabsStaff } from '@/components/library/options/tabs';
import { SAMPLE_TEX } from '@/components/library/options/tabs/sample';
import { displaySettings } from '@/lib/tabScore';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TabScoreProps {
  staff: TabsStaff;
  scroll: TabsScroll;
  /** Index into the sample's tracks (0 guitar, 1 bass). */
  track: number;
  /** AlphaTab's display scale: smaller on phone, like the planned viewer. */
  scale?: number;
  className?: string;
}

// alphaTab ships no types we can reach through a dynamic import without
// pulling its whole surface in; the few members used here are named below.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** One import for every frame on the page (desktop, phone, full screen). */
let alphaTabModule: Promise<any> | null = null;
const loadAlphaTab = () => (alphaTabModule ??= import('@coderline/alphatab'));

/** The real score, drawn by AlphaTab from the bundled sample, with the
 *  settings the tab page uses (docs/tabs-rebuild.md section 4): tab staff
 *  with rhythm stems and beams, Tab or Tab + Score, Ember's dark colours,
 *  page or horizontal layout. The cursor is placed on a fixed beat in bar 2
 *  so the preview shows what playback looks like; nothing plays. */
export function TabScore(props: TabScoreProps) {
  // A fresh drawing per setting: AlphaTab is rebuilt anyway, and a new key
  // starts the loading state over without resetting it inside an effect.
  const { staff, scroll, track, scale = 0.9 } = props;
  return <ScoreCanvas key={`${staff}:${scroll}:${track}:${scale}`} {...props} />;
}

function ScoreCanvas({ staff, scroll, track, scale = 0.9, className }: TabScoreProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cursor, setCursor] = useState<{ bar: Rect; beat: Rect } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let api: any = null;

    (async () => {
      try {
        const at: any = await loadAlphaTab();
        const host = hostRef.current;
        if (cancelled || !host) return;
        // AlphaTab measures its container once, at construction: wait for a
        // real width (a scaled frame or a portal can still be laying out).
        for (let i = 0; i < 60 && host.clientWidth === 0 && !cancelled; i++) {
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        if (cancelled) return;

        api = new at.AlphaTabApi(host, {
          core: {
            engine: 'svg',
            // Same place the tab page loads Bravura from (public/alphatab/font).
            fontDirectory: '/alphatab/font/',
            // Main thread: the worker's script URL cannot be derived when
            // alphaTab comes through the bundler (see LiveTabScore).
            useWorkers: false,
          },
          // The tab page's own look (lib/tabScore.ts).
          ...displaySettings(at, { staff, scroll, scale }),
          player: { enablePlayer: false, enableCursor: false },
        });

        api.error?.on?.(() => {
          if (!cancelled) setStatus('error');
        });
        api.postRenderFinished?.on?.(() => {
          if (cancelled) return;
          setStatus('ready');
          // Bar 2, third beat: far enough in to read as "playing".
          const beat = api.score?.tracks?.[track]?.staves?.[0]?.bars?.[1]?.voices?.[0]?.beats?.[2];
          const bounds = beat ? api.renderer?.boundsLookup?.findBeat?.(beat) : null;
          const bar = bounds?.barBounds?.masterBarBounds?.visualBounds;
          const b = bounds?.visualBounds;
          if (!bar || !b) return;
          const next = {
            bar: { x: bar.x, y: bar.y, w: bar.w, h: bar.h },
            beat: { x: b.x + b.w / 2 - 1.5, y: bar.y, w: 3, h: bar.h },
          };
          setCursor(next);
          // Horizontal: keep the cursor a third of the way in, like the
          // follow-scroll will.
          const scroller = scrollerRef.current;
          if (scroll === 'horizontal' && scroller) {
            scroller.scrollLeft = Math.max(0, next.beat.x - scroller.clientWidth / 3);
          }
        });
        api.tex(SAMPLE_TEX, [track]);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      try {
        api?.destroy();
      } catch {
        // A half-initialised AlphaTab can throw on destroy; it is going anyway.
      }
    };
  }, [staff, scroll, track, scale]);

  return (
    <div
      ref={scrollerRef}
      data-testid="tab-score"
      data-staff={staff}
      data-scroll={scroll}
      data-track={track}
      data-status={status}
      className={cn(
        'relative min-w-0',
        scroll === 'horizontal' && 'overflow-x-auto overflow-y-hidden',
        className,
      )}
    >
      <div className="relative">
        {cursor && (
          <>
            <div
              aria-hidden
              data-testid="tab-cursor"
              className="at-cursor-bar pointer-events-none absolute rounded-sm"
              style={{ left: cursor.bar.x, top: cursor.bar.y, width: cursor.bar.w, height: cursor.bar.h }}
            />
            <div
              aria-hidden
              className="at-cursor-beat pointer-events-none absolute z-10"
              style={{ left: cursor.beat.x, top: cursor.beat.y, height: cursor.beat.h }}
            />
          </>
        )}
        <div ref={hostRef} className="w-full" />
      </div>
      {status === 'loading' && <div className="text-meta py-block">Drawing the tab…</div>}
      {status === 'error' && <div className="text-meta py-block">The sample tab could not be drawn.</div>}
    </div>
  );
}
