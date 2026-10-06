'use client';

import type { ReactNode } from 'react';
import { ChevronLeftIcon, GaugeIcon, PauseIcon, PlayIcon, RepeatIcon, SlidersIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** The stage (the owner's pick for the tab page): the tab fills the screen,
 *  with one thin title line on top and a floating pill at the bottom.
 *  Presentational; TabsPage owns the state. */

export interface StageHeaderProps {
  title: string;
  /** "Coastline · Rhythm guitar · 75%" (lib/tabStage.ts stageMeta). */
  meta: string;
  /** The whole meta line (tempo, key, tuning), in the tooltip. */
  metaTitle?: string;
  /** Fade back while the song plays; a hover or focus brings it back. */
  dim: boolean;
  /** Beside the title: which tab, and Line it up. */
  chip?: ReactNode;
  /** The ⋯ menu. */
  actions?: ReactNode;
  onBack: () => void;
}

/** Back, the title over the meta line, the chip and the ⋯ menu, in one
 *  line. */
export function StageHeader({ title, meta, metaTitle, dim, chip, actions, onBack }: StageHeaderProps) {
  return (
    <div
      data-testid="tab-stage-header"
      data-dim={dim || undefined}
      className={cn(
        'flex min-w-0 items-center gap-cluster py-cluster transition-opacity duration-300',
        dim && 'opacity-40 hover:opacity-100 focus-within:opacity-100',
      )}
    >
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronLeftIcon className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold leading-tight" title={title}>
          {title}
        </h1>
        <p data-testid="tab-stage-meta" className="truncate text-xs text-muted-foreground" title={metaTitle ?? meta}>
          {meta}
        </p>
      </div>
      {chip && <div className="flex min-w-0 shrink items-center gap-cluster">{chip}</div>}
      {actions && <div className="flex shrink-0 items-center">{actions}</div>}
    </div>
  );
}

export interface PlayPillProps {
  playing: boolean;
  /** Nothing to play from here (a song Ember cannot play). */
  canPlay: boolean;
  onPlayPause: () => void;
  /** "Bar 3 / 24", or the count-in while it counts. */
  label: string;
  speedPercent: number;
  canSetRate: boolean;
  onSlower: () => void;
  loopOn: boolean;
  /** "Bars 3–6" once a loop is chosen. */
  loopLabel: string | null;
  onLoop: () => void;
  /** The button for the rest of the practice tools, where the page has
   *  one (phones). */
  more?: { open: boolean; onToggle: () => void };
}

const pillButton =
  'inline-flex h-9 shrink-0 items-center gap-inset rounded-full px-row text-xs font-semibold tabular-nums transition-colors hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent';

/** Play or pause, where you are, the speed (a tap is one step slower) and
 *  the loop (a tap turns it on or off), floating over the tab. */
export function PlayPill(p: PlayPillProps) {
  return (
    <div
      data-testid="tab-pill"
      role="group"
      aria-label="Playback"
      className="pointer-events-auto flex max-w-full min-w-0 items-center gap-inset rounded-full border border-border bg-popover/90 p-inset text-popover-foreground shadow-soft backdrop-blur"
    >
      <button
        type="button"
        aria-label={p.playing ? 'Pause' : 'Play'}
        disabled={!p.canPlay}
        onClick={p.onPlayPause}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-50"
      >
        {p.playing ? <PauseIcon className="size-4 fill-current" /> : <PlayIcon className="size-4 translate-x-px fill-current" />}
      </button>
      <span
        data-testid="tab-pill-bar"
        aria-live="off"
        className="min-w-16 shrink-0 truncate px-cluster text-center text-xs tabular-nums text-muted-foreground"
      >
        {p.label}
      </span>
      <button
        type="button"
        aria-label={`Speed ${p.speedPercent}%, tap to slow down`}
        title={p.canSetRate ? 'Tap to slow down' : 'Slowing down works in the browser for now'}
        disabled={!p.canSetRate}
        onClick={p.onSlower}
        className={cn(pillButton, p.speedPercent !== 100 && 'text-ember')}
      >
        <GaugeIcon className="size-4" />
        {p.speedPercent}%
      </button>
      <button
        type="button"
        aria-label="Loop the bars"
        aria-pressed={p.loopOn}
        title={p.loopLabel ? `Loop ${p.loopLabel.toLowerCase()}` : 'Choose bars to loop'}
        onClick={p.onLoop}
        className={cn(pillButton, 'min-w-0', p.loopOn && 'text-ember')}
      >
        <RepeatIcon className="size-4 shrink-0" />
        {p.loopLabel && <span className="min-w-0 truncate">{p.loopLabel}</span>}
      </button>
      {p.more && (
        <button
          type="button"
          aria-label="Practice tools"
          aria-expanded={p.more.open}
          onClick={p.more.onToggle}
          className={cn(pillButton, p.more.open && 'bg-muted text-foreground')}
        >
          <SlidersIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
