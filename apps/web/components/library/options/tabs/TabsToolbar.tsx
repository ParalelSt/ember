'use client';

import { useState } from 'react';
import { RepeatIcon, TabsIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { TabsScroll, TabsStaff } from '@/components/library/options/tabs';
import { SAMPLE_TRACKS } from '@/components/library/options/tabs/sample';

const SPEEDS = [50, 75, 90, 100, 110];

const chip =
  'inline-flex shrink-0 items-center gap-inset rounded-full border px-row py-inset text-xs font-medium transition-colors';
const chipOff = 'border-border text-muted-foreground hover:bg-card hover:text-foreground';
const chipOn = 'border-ember/40 bg-ember/15 text-ember';

export interface TabsToolbarProps {
  phone: boolean;
  staff: TabsStaff;
  scroll: TabsScroll;
  track: number;
  onStaffChange: (staff: TabsStaff) => void;
  onScrollChange: (scroll: TabsScroll) => void;
  onTrackChange: (track: number) => void;
  /** Stage: a floating translucent bar instead of a flat row. */
  floating?: boolean;
}

/** The tab toolbar every candidate shares. Track picker, Tab or Tab + Score
 *  and Horizontal work in the preview (they redraw the real score); speed,
 *  loop and count-in toggle their own look only, because they need the
 *  playback wiring of stages 3 and 4. */
export function TabsToolbar({
  phone,
  staff,
  scroll,
  track,
  onStaffChange,
  onScrollChange,
  onTrackChange,
  floating = false,
}: TabsToolbarProps) {
  const [speed, setSpeed] = useState(3);
  const [loop, setLoop] = useState(false);
  const [countIn, setCountIn] = useState(true);

  return (
    <div
      data-testid="tabs-toolbar"
      role="toolbar"
      aria-label="Tab controls"
      className={cn(
        'flex min-w-0 items-center gap-cluster overflow-x-auto',
        floating && 'rounded-full border border-border bg-popover/80 px-row py-cluster shadow-soft backdrop-blur',
      )}
    >
      <div className="flex shrink-0 items-center gap-inset" aria-label="Tracks" role="group">
        {SAMPLE_TRACKS.map((t, i) => (
          <button
            key={t.name}
            type="button"
            aria-pressed={i === track}
            onClick={() => onTrackChange(i)}
            title={`${t.instrument}, ${t.tuning} (${t.strings})`}
            className={cn(chip, i === track ? chipOn : chipOff)}
          >
            <TabsIcon className="size-3.5" />
            {t.name}
            {!phone && <span className="font-normal opacity-70">{t.tuning}</span>}
          </button>
        ))}
      </div>

      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      <div className="flex shrink-0 items-center rounded-full bg-muted p-inset" role="group" aria-label="Notation">
        {(['tab', 'score-tab'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={staff === s}
            onClick={() => onStaffChange(s)}
            className={cn(
              'rounded-full px-row py-inset text-xs font-medium transition-colors',
              staff === s ? 'bg-background text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s === 'tab' ? 'Tab' : phone ? '+ Score' : 'Tab + Score'}
          </button>
        ))}
      </div>

      <div
        className={cn(chip, chipOff, 'gap-cluster')}
        role="group"
        aria-label="Speed"
        title="Playback speed, pitch kept (wired in stage 4)"
      >
        <button
          type="button"
          aria-label="Slower"
          onClick={() => setSpeed((i) => Math.max(0, i - 1))}
          className="text-foreground/80 hover:text-foreground"
        >
          −
        </button>
        <span className="tabular-nums text-foreground">{SPEEDS[speed]}%</span>
        <button
          type="button"
          aria-label="Faster"
          onClick={() => setSpeed((i) => Math.min(SPEEDS.length - 1, i + 1))}
          className="text-foreground/80 hover:text-foreground"
        >
          +
        </button>
      </div>

      <button
        type="button"
        aria-pressed={loop}
        aria-label="Loop"
        onClick={() => setLoop((v) => !v)}
        title="Loop a range of bars (wired in stage 4)"
        className={cn(chip, loop ? chipOn : chipOff)}
      >
        <RepeatIcon className="size-3.5" />
        {!phone && 'Loop'}
      </button>

      <button
        type="button"
        aria-pressed={countIn}
        aria-label="Count-in"
        onClick={() => setCountIn((v) => !v)}
        title="One bar of clicks before playback resumes (wired in stage 4)"
        className={cn(chip, countIn ? chipOn : chipOff)}
      >
        {phone ? '1234' : 'Count-in'}
      </button>

      <button
        type="button"
        aria-pressed={scroll === 'horizontal'}
        aria-label="Horizontal"
        onClick={() => onScrollChange(scroll === 'horizontal' ? 'vertical' : 'horizontal')}
        title="One row that scrolls sideways, like Songsterr"
        className={cn(chip, scroll === 'horizontal' ? chipOn : chipOff)}
      >
        <span aria-hidden>⇆</span>
        {!phone && 'Horizontal'}
      </button>
    </div>
  );
}
