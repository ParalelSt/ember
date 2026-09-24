'use client';

/* PREVIEW ONLY. Delete this file, and every `useTopBarPreview` read, once
 * the owner picks a desktop top bar. It lets them scroll real pages under
 * each /dizajn candidate (components/library/options/topbar):
 *
 *   1  floating pill (recommended)   3  solid strip
 *   2  frosted bar                   4  as it is now
 *
 * The pick comes from `?topbar=1|2|3|4`, else localStorage, else 4 (so every
 * existing browser test still sees the layout as it is), and the
 * switcher pill (bottom-left of the content column, desktop only) changes
 * it live. Modes 1 to 3 put the search bar `sticky top-0` INSIDE
 * `data-app-scroller` (app/(app)/layout.tsx), so the scrollbar spans the
 * whole column; mode 4 is the layout as it is. After the pick: keep only
 * the chosen branch in layout.tsx, SearchDropdown.tsx and LyricsPanel.tsx
 * and delete the rest. */

import { useEffect } from 'react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

export type TopBarMode = 1 | 2 | 3 | 4;
export const TOPBAR_MODES: TopBarMode[] = [1, 2, 3, 4];
const KEY = 'ember-topbar-preview';
const DEFAULT_MODE: TopBarMode = 4;

interface TopBarPreviewState {
  mode: TopBarMode;
  /** The sticky bar's own height in px (modes 1 to 3; 0 in mode 4 or when
   *  no bar is mounted, e.g. on /search). Published by the layout as
   *  `--ember-topbar-h` for the LyricsPanel and the dropdown's cap. */
  barH: number;
  setMode: (m: TopBarMode) => void;
  setBarH: (h: number) => void;
}

function parse(v: string | null | undefined): TopBarMode | null {
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

export const useTopBarPreview = create<TopBarPreviewState>((set) => ({
  mode: DEFAULT_MODE,
  barH: 0,
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, String(mode));
    } catch {
      /* storage blocked: the pick just is not remembered */
    }
    // Keep a `?topbar=` in the address bar in step, or a reload would put
    // the old one back.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('topbar')) {
        url.searchParams.set('topbar', String(mode));
        window.history.replaceState(window.history.state, '', url);
      }
    } catch {
      /* no window */
    }
    set({ mode });
  },
  setBarH: (barH) => set({ barH }),
}));

/** Reads `?topbar=` (and remembers it), else the remembered pick. Once, on
 *  the client, from the app layout. */
export function useTopBarPreviewInit() {
  useEffect(() => {
    let mode: TopBarMode | null = null;
    try {
      mode = parse(new URLSearchParams(window.location.search).get('topbar'));
      if (mode) localStorage.setItem(KEY, String(mode));
      else mode = parse(localStorage.getItem(KEY));
    } catch {
      /* storage blocked */
    }
    if (mode) useTopBarPreview.setState({ mode });
  }, []);
}

/** The "Top bar: 1 2 3 4" pill. Absolute in the content column (the
 *  layout's `relative` column), so it sits bottom-left above the player
 *  bar. Desktop only: the phone layout has no top bar to compare. */
export function TopBarPreviewSwitch() {
  const mode = useTopBarPreview((s) => s.mode);
  const setMode = useTopBarPreview((s) => s.setMode);
  return (
    <div
      data-testid="topbar-preview-switch"
      role="group"
      aria-label="Top bar preview"
      className="absolute bottom-block left-block z-40 hidden items-center gap-inset rounded-full bg-popover py-inset pl-row pr-inset text-xs text-popover-foreground shadow-soft ring-1 ring-foreground/10 md:flex"
    >
      <span className="pr-inset font-semibold">Top bar:</span>
      {TOPBAR_MODES.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            'size-7 rounded-full font-semibold transition-colors',
            mode === m ? 'bg-ember text-ember-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
