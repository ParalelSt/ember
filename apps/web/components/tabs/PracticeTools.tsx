'use client';

import { useState, type ReactNode } from 'react';
import { ClockIcon, GaugeIcon, RepeatIcon, TimerIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { chip, chipOff, chipOn } from '@/components/tabs/chips';
import { cn } from '@/lib/utils';
import {
  bpmAtRate,
  rangeLabel,
  rateFromBpm,
  rateFromPercent,
  SPEED_PRESETS,
  type BarRange,
  type SectionRange,
} from '@/lib/tabPractice';
import { clampOffset } from '@/lib/tabSync';
import {
  formatOffset,
  nudgeSteps,
  offsetFromInput,
  offsetInUnit,
  sliderSpanSec,
  type BeatClock,
  type OffsetUnit,
} from '@/lib/tabOffset';
import { COUNT_IN_CHOICES, type CountInBars, type ToolCell, type ToolId } from '@/lib/tabStage';

/** The practice toolbar (the owner's pick): Speed, Loop, Click, Count-in
 *  and Delay, each showing its value; a tap opens a small popover with the
 *  fine controls. On a phone it is a strip of five cells above the pill;
 *  on a wider screen a row with names over the tab. Presentational: the
 *  page owns every value. */

/** The metronome override's bounds, as a tab's own tempo is kept. */
export const MIN_BPM = 20;
export const MAX_BPM = 400;

const input =
  'h-7 rounded-md border border-border bg-background px-cluster text-right text-xs tabular-nums text-foreground disabled:opacity-50';

function CellIcon({ id, className }: { id: ToolId; className?: string }) {
  if (id === 'speed') return <GaugeIcon className={className} />;
  if (id === 'loop') return <RepeatIcon className={className} />;
  if (id === 'click') return <ClockIcon className={className} />;
  if (id === 'delay') return <TimerIcon className={className} />;
  return (
    <span aria-hidden className="text-[11px] font-bold leading-4 tracking-wide">
      1234
    </span>
  );
}

export function PracticeToolbar({
  phone,
  cells,
  open,
  onOpen,
}: {
  phone: boolean;
  cells: ToolCell[];
  /** The cell whose popover is open. */
  open: ToolId | null;
  onOpen: (id: ToolId | null) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Practice"
      data-testid="tab-tools"
      className={cn(
        'pointer-events-auto min-w-0',
        phone
          ? 'grid w-full grid-cols-5 overflow-hidden rounded-2xl border border-border bg-popover/95 text-popover-foreground shadow-soft backdrop-blur'
          : 'flex flex-wrap items-center gap-inset',
      )}
    >
      {cells.map((c) => (
        <button
          key={c.id}
          type="button"
          data-testid={`tab-tool-${c.id}`}
          aria-label={`${c.name}, ${c.value}`}
          aria-haspopup="dialog"
          aria-expanded={open === c.id}
          onClick={() => onOpen(open === c.id ? null : c.id)}
          className={cn(
            'min-w-0 transition-colors',
            phone
              ? 'flex flex-col items-center gap-inset px-inset py-cluster text-[10.5px]'
              : 'inline-flex items-center gap-cluster rounded-lg px-row py-cluster text-xs',
            c.on ? 'text-ember' : 'text-muted-foreground',
            open === c.id ? 'bg-muted' : 'hover:bg-muted/60',
          )}
        >
          <CellIcon id={c.id} className="size-4 shrink-0" />
          {phone ? (
            <>
              <b className={cn('max-w-full truncate text-[11.5px] tabular-nums', c.on ? 'text-ember' : 'text-foreground')}>{c.value}</b>
              <span className="max-w-full truncate">{c.name}</span>
            </>
          ) : (
            <>
              <span>{c.name}</span>
              <b className={cn('tabular-nums', c.on ? 'text-ember' : 'text-foreground')}>{c.value}</b>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

/** The fine controls of one cell, in a small card. */
export function ToolPopover({ id, title, children }: { id: ToolId; title: string; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      data-testid={`tab-popover-${id}`}
      className="pointer-events-auto max-h-[60vh] w-full min-w-0 overflow-y-auto rounded-2xl border border-border bg-popover p-row text-popover-foreground shadow-soft"
    >
      {children}
    </div>
  );
}

function Head({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-cluster flex min-w-0 items-center justify-between gap-row text-sm">
      <span className="min-w-0 font-medium text-foreground">
        {title}
        {note && <span className="font-normal text-muted-foreground"> · {note}</span>}
      </span>
      {children}
    </div>
  );
}

/** An on/off switch, as the picker draws them. */
function Switch({ label, on, disabled, title, onChange }: { label: string; on: boolean; disabled?: boolean; title?: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
        on ? 'bg-ember' : 'bg-muted-foreground/40',
      )}
    >
      <span
        aria-hidden
        className={cn('absolute top-0.5 size-4 rounded-full bg-background shadow-soft transition-all', on ? 'left-4.5' : 'left-0.5')}
      />
    </button>
  );
}

// ── Speed ─────────────────────────────────────────────────────────────────

/** The speed (pitch kept): presets, a percent, or the tempo it plays at. */
export function SpeedEditor({
  canSetRate,
  speed,
  onSpeed,
  tabBpm,
}: {
  canSetRate: boolean;
  speed: number;
  onSpeed: (rate: number) => void;
  /** The tab's tempo at the playhead. */
  tabBpm: number | null;
}) {
  const percent = Math.round(speed * 100);
  const heard = bpmAtRate(tabBpm, speed);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);
  const [percentDraft, setPercentDraft] = useState<string | null>(null);
  return (
    <div data-testid="tab-speed" className="flex flex-col gap-cluster text-xs text-muted-foreground">
      <Head title="Speed" note={`${percent}%${heard ? ` · ${heard} bpm` : ''}`} />
      {canSetRate ? (
        <>
          <div className="flex flex-wrap items-center gap-inset" role="group" aria-label="Speed presets">
            {SPEED_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={percent === p}
                onClick={() => {
                  setPercentDraft(null);
                  setBpmDraft(null);
                  onSpeed(rateFromPercent(p));
                }}
                className={cn(chip, percent === p ? chipOn : chipOff, 'tabular-nums')}
              >
                {p}%
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-row">
            <label className="flex items-center gap-inset">
              <input
                type="number"
                inputMode="numeric"
                min={50}
                max={125}
                step={5}
                value={percentDraft ?? String(percent)}
                onChange={(e) => {
                  setPercentDraft(e.target.value);
                  setBpmDraft(null);
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 50 && n <= 125) onSpeed(rateFromPercent(n));
                }}
                onBlur={() => setPercentDraft(null)}
                className={cn(input, 'w-16')}
                aria-label="Speed in percent"
              />
              <span>%</span>
            </label>
            {tabBpm ? (
              <label className="flex items-center gap-inset">
                <span>=</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={bpmDraft ?? String(heard ?? '')}
                  onChange={(e) => {
                    setBpmDraft(e.target.value);
                    setPercentDraft(null);
                    const r = rateFromBpm(Number(e.target.value), tabBpm);
                    if (r !== null) onSpeed(r);
                  }}
                  onBlur={() => setBpmDraft(null)}
                  className={cn(input, 'w-16')}
                  aria-label="Speed in bpm"
                />
                <span>bpm (the tab: {Math.round(tabBpm)})</span>
              </label>
            ) : null}
          </div>
        </>
      ) : (
        <span data-testid="tab-speed-unavailable">Slowing down works in the browser for now; this app plays at full speed.</span>
      )}
    </div>
  );
}

// ── Loop ──────────────────────────────────────────────────────────────────

/** A loop over a section or a range of bars, picked on the tab or typed. */
export function LoopEditor({
  timeline,
  barTotal,
  sections,
  range,
  loopOn,
  onLoopOn,
  onRange,
  onClear,
  picking,
  onPick,
}: {
  /** The score is drawn, so its bars are known. */
  timeline: boolean;
  barTotal: number;
  sections: SectionRange[];
  range: BarRange | null;
  loopOn: boolean;
  onLoopOn: (on: boolean) => void;
  onRange: (range: BarRange) => void;
  onClear: () => void;
  picking: boolean;
  /** Start (or cancel) choosing the bars on the tab. */
  onPick: () => void;
}) {
  const barInput = (label: string, value: number | undefined, set: (bar: number) => void) => (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={Math.max(1, barTotal)}
      step={1}
      value={value === undefined ? '' : value + 1}
      disabled={!timeline}
      onChange={(e) => {
        const n = Math.round(Number(e.target.value));
        if (Number.isFinite(n) && n >= 1) set(n - 1);
      }}
      className={cn(input, 'w-14')}
      aria-label={label}
    />
  );
  return (
    <div data-testid="tab-practice" className="flex flex-col gap-cluster text-xs text-muted-foreground">
      <Head title="Loop" note={range ? rangeLabel(range) : undefined}>
        <Switch
          label="Loop"
          on={loopOn}
          disabled={!range}
          title={range ? `Loop ${rangeLabel(range).toLowerCase()}` : 'Choose bars or a section to loop first'}
          onChange={onLoopOn}
        />
      </Head>
      {sections.length > 0 && (
        <div className="flex flex-wrap items-center gap-inset" role="group" aria-label="Loop a section">
          {sections.map((sct) => {
            const on = !!range && range.start === sct.start && range.end === sct.end;
            return (
              <button
                key={`${sct.start}:${sct.name}`}
                type="button"
                aria-pressed={on}
                title={rangeLabel(sct)}
                onClick={() => onRange({ start: sct.start, end: sct.end })}
                className={cn(chip, on ? chipOn : chipOff, 'max-w-40 truncate')}
              >
                {sct.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-inset">
        <span>Bars</span>
        {barInput('Loop from bar', range?.start, (b) => onRange({ start: b, end: Math.max(b, range?.end ?? b) }))}
        <span>to</span>
        {barInput('Loop to bar', range?.end, (b) => onRange({ start: Math.min(b, range?.start ?? b), end: b }))}
        {barTotal > 0 && <span>of {barTotal}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-inset">
        <Button size="sm" variant="outline" disabled={!timeline} onClick={onPick}>
          {picking ? 'Cancel picking' : 'Pick bars on the tab'}
        </Button>
        {range && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Click ─────────────────────────────────────────────────────────────────

/** The metronome: on or off, and its tempo, the tab's (which changes where
 *  the tab does) or one the listener sets because the tab's is wrong. */
export function ClickEditor({
  on,
  canClick,
  onToggle,
  tabBpm,
  steps,
  override,
  onOverride,
}: {
  on: boolean;
  /** The tab is drawn, so its beats are known. */
  canClick: boolean;
  onToggle: () => void;
  /** The tab's tempo at the playhead. */
  tabBpm: number | null;
  /** Every tempo the tab plays at, in order. */
  steps: number[];
  override: number | null;
  onOverride: (bpm: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (override !== null ? String(override) : '');
  const tabText = tabBpm ? `${Math.round(tabBpm)} bpm` : 'no tempo';
  const now = override ?? (tabBpm ? Math.round(tabBpm) : null);
  const step = (by: number) => {
    if (now === null) return;
    setDraft(null);
    onOverride(Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(now) + by)));
  };
  return (
    <div data-testid="tab-metronome" className="flex flex-col gap-cluster text-xs text-muted-foreground">
      <Head title="Metronome">
        <Switch
          label="Metronome"
          on={on}
          disabled={!canClick}
          title={canClick ? 'Clicks on the beat, following the tab’s tempo' : 'The metronome starts once the tab is drawn'}
          onChange={onToggle}
        />
      </Head>
      <div className="flex flex-wrap items-center gap-cluster">
        <button
          type="button"
          aria-label="Slower click"
          disabled={now === null}
          onClick={() => step(-1)}
          className="grid size-8 place-items-center rounded-full border border-border text-base text-foreground hover:bg-muted disabled:opacity-50"
        >
          −
        </button>
        <span data-testid="tab-metronome-bpm" className="min-w-16 text-center text-sm font-semibold tabular-nums text-foreground">
          {now !== null ? `${now} bpm` : 'No tempo'}
        </span>
        <button
          type="button"
          aria-label="Faster click"
          disabled={now === null}
          onClick={() => step(1)}
          className="grid size-8 place-items-center rounded-full border border-border text-base text-foreground hover:bg-muted disabled:opacity-50"
        >
          +
        </button>
        <label className="flex items-center gap-inset">
          <span>Set bpm</span>
          <input
            type="number"
            inputMode="decimal"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={shown}
            placeholder={tabBpm ? String(Math.round(tabBpm)) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const n = Number(raw);
              if (raw.trim() === '') onOverride(null);
              else if (Number.isFinite(n) && n >= MIN_BPM && n <= MAX_BPM) onOverride(n);
            }}
            onBlur={() => setDraft(null)}
            className={cn(input, 'w-20')}
            aria-label="Metronome bpm"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-cluster">
        <span data-testid="tab-metronome-status">
          {override !== null
            ? `Clicking at ${override} bpm; the tab says ${tabText} here.`
            : `Follows the tab: ${tabText} here${steps.length > 1 ? ` (tempo changes ${steps.join(' → ')})` : ''}.`}
        </span>
        {override !== null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(null);
              onOverride(null);
            }}
          >
            Use the tab’s tempo
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Count-in ──────────────────────────────────────────────────────────────

export function CountInEditor({ value, onChange }: { value: CountInBars; onChange: (v: CountInBars) => void }) {
  return (
    <div data-testid="tab-count-in" className="flex flex-col gap-cluster text-xs text-muted-foreground">
      <Head title="Count-in" note="clicks before the song starts from Play here" />
      <div className="flex w-fit items-center rounded-full bg-muted p-inset" role="group" aria-label="Count-in">
        {COUNT_IN_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={cn(
              'rounded-full px-row py-inset text-xs font-medium transition-colors',
              value === n ? 'bg-background text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {n === 0 ? 'Off' : `${n} bar${n === 1 ? '' : 's'}`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Delay ─────────────────────────────────────────────────────────────────

/** The nudge: slide the tab against the recording. Kept on this device;
 *  whoever added the tab can save it for everyone. A slider for the rough
 *  place, steps and a box for the exact one, in seconds or in beats of the
 *  tab (its tempo and time signature, lib/tabOffset.ts). */
export function DelayEditor({
  offsetMs,
  unit,
  clock,
  onUnitChange,
  shared,
  canShare,
  onChange,
  onShare,
}: {
  offsetMs: number;
  unit: OffsetUnit;
  clock: BeatClock | null;
  onUnitChange: (unit: OffsetUnit) => void;
  shared: number;
  canShare: boolean;
  onChange: (ms: number | null) => void;
  onShare: () => void;
}) {
  const shown: OffsetUnit = unit === 'beats' && clock ? 'beats' : 'seconds';
  const span = sliderSpanSec(offsetMs);
  const value = offsetInUnit(offsetMs, shown, clock);
  // The box keeps what is being typed ("-", "1.") until it reads as a
  // number; it shows the nudge again whenever the nudge changes elsewhere.
  const [draft, setDraft] = useState<{ text: string; for: string } | null>(null);
  const key = `${offsetMs}|${shown}`;
  const text = draft && draft.for === key ? draft.text : String(value);
  const commit = (raw: string) => {
    const ms = offsetFromInput(raw, shown, clock);
    setDraft({ text: raw, for: ms === null ? key : `${clampOffset(ms)}|${shown}` });
    if (ms !== null && ms !== offsetMs) onChange(ms);
  };
  const how = offsetMs > 0 ? 'the tab runs ahead' : offsetMs < 0 ? 'the tab runs behind' : 'in sync';
  return (
    <div data-testid="tab-sync" className="flex flex-col gap-cluster text-xs text-muted-foreground">
      <Head title="Delay" note={`${formatOffset(offsetMs, unit, clock)}, ${how}`} />
      <div className="flex flex-wrap items-center gap-row">
        <input
          type="range"
          min={-span}
          max={span}
          step={0.01}
          value={offsetMs / 1000}
          onChange={(e) => onChange(Number(e.target.value) * 1000)}
          className="min-w-40 flex-1 accent-ember"
          aria-label="Tab timing offset in seconds"
        />
        <div className="flex shrink-0 items-center gap-inset">
          <input
            type="number"
            inputMode="decimal"
            step={shown === 'beats' ? 0.25 : 0.01}
            value={text}
            onChange={(e) => commit(e.target.value)}
            className={cn(input, 'w-24')}
            aria-label={shown === 'beats' ? 'Tab timing offset in beats' : 'Tab timing offset, exact seconds'}
          />
          <div className="flex items-center rounded-full bg-muted p-inset" role="group" aria-label="Offset unit">
            {(['seconds', 'beats'] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={shown === u}
                disabled={u === 'beats' && !clock}
                title={u === 'beats' && !clock ? 'This tab has no tempo to count beats by' : undefined}
                onClick={() => onUnitChange(u)}
                className={cn(
                  'rounded-full px-row py-inset text-xs font-medium transition-colors disabled:opacity-40',
                  shown === u ? 'bg-background text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {u === 'seconds' ? 's' : 'beats'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-inset">
        {nudgeSteps(shown, clock).map((s) => (
          <Button key={s.label} size="sm" variant="ghost" className="tabular-nums" onClick={() => onChange(clampOffset(offsetMs + s.ms))}>
            {s.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onChange(0)}>
          Reset
        </Button>
        {canShare && offsetMs !== shared && (
          <Button size="sm" variant="outline" onClick={onShare}>
            Save for everyone
          </Button>
        )}
        {canShare && offsetMs === shared && shared !== 0 && <span>Saved for everyone</span>}
        {shown === 'beats' && clock && (
          <span className="tabular-nums" data-testid="tab-sync-beat">
            1 beat = {Math.round((60_000 / clock.bpm) * (4 / clock.denominator))} ms at {Math.round(clock.bpm)} bpm, {clock.numerator}/{clock.denominator}
          </span>
        )}
      </div>
    </div>
  );
}
