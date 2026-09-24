'use client';

import { useState } from 'react';
import { AlertIcon, RepeatIcon, VolumeIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatTime } from '@/lib/format';
import { intervalWords } from '@/lib/pranks/copy';
import { PRANK_LIMITS } from '@/lib/pranks/limits';
import type { PrankPerson, PrankSound } from '@/lib/pranks/types';
import { cn } from '@/lib/utils';

export type SoundMode = 'over' | 'duck';

export interface RepeatRequest {
  soundId: string;
  mode: SoundMode;
  intervalSec: number;
  endsAt: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "21:30" as the next moment on the clock at that time: today, or
 *  tomorrow when it has already passed. Null for anything else. */
export function untilDate(value: string, now: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

const MODES: { id: SoundMode; label: string }[] = [
  { id: 'duck', label: 'Turn their music down' },
  { id: 'over', label: 'Over their music' },
];

/** The composer card: fills in once a person is picked. A sound from the
 *  library, over the music or with the music turned down, sent once or
 *  repeated every N minutes until a time. The hourly limit is shown for the
 *  picked person. */
export function Composer({
  person,
  sounds,
  disabled,
  busy,
  repeatsRunning,
  onSend,
  onRepeat,
  onStopRepeats,
}: {
  person: PrankPerson | null;
  sounds: PrankSound[];
  /** The switch is off. */
  disabled: boolean;
  busy: boolean;
  /** How many repeats are running on the picked person. */
  repeatsRunning: number;
  onSend: (soundId: string, mode: SoundMode) => void;
  onRepeat: (req: RepeatRequest) => void;
  onStopRepeats: () => void;
}) {
  const [soundId, setSoundId] = useState<string | null>(null);
  const [mode, setMode] = useState<SoundMode>('duck');
  const [repeat, setRepeat] = useState(false);
  const [everyMin, setEveryMin] = useState('5');
  const [until, setUntil] = useState(() => hhmm(new Date(Date.now() + 30 * 60_000)));

  const sound = sounds.find((s) => s.id === soundId) ?? null;
  const off = disabled || !person;
  const L = PRANK_LIMITS;
  const minutes = Number(everyMin);
  const intervalOk = Number.isInteger(minutes) && minutes >= 1 && minutes <= L.scheduleMaxSpanSec / 60;
  const canSend = !off && !busy && !!sound && (!repeat || (intervalOk && untilDate(until, new Date()) !== null));

  const submit = () => {
    if (!sound || !canSend) return;
    if (!repeat) return onSend(sound.id, mode);
    const endsAt = untilDate(until, new Date());
    if (endsAt) onRepeat({ soundId: sound.id, mode, intervalSec: minutes * 60, endsAt });
  };

  return (
    <div data-testid="prank-composer" className="flex flex-col gap-block rounded-lg border border-border p-row">
      <div>
        <div className="text-row-title">{person ? `Send a sound to ${person.name}` : 'Pick a person to send a sound'}</div>
        {person && <div className="text-row-sub">{person.line}</div>}
        {disabled && <div className="text-row-sub">Pranks are off, so nothing can be sent.</div>}
      </div>

      <div className="flex flex-col gap-inset">
        <div className="text-eyebrow">Sound</div>
        {sounds.length === 0 ? (
          <div className="text-row-sub">The library is empty: upload a sound below.</div>
        ) : (
          <div role="radiogroup" aria-label="Sound" className="flex flex-col gap-inset">
            {sounds.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={soundId === s.id}
                disabled={off}
                onClick={() => setSoundId(s.id)}
                className={cn(
                  'flex items-center justify-between gap-row rounded-md px-row py-inset text-left text-sm transition-colors disabled:opacity-40',
                  soundId === s.id ? 'bg-ember/15 text-foreground' : 'hover:bg-card',
                )}
              >
                <span className="min-w-0 truncate">{s.name}</span>
                <span className="text-row-sub tabular-nums">{formatTime(s.durationSec)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div role="radiogroup" aria-label="Their music" className="flex flex-wrap items-center gap-inset">
        <VolumeIcon className="size-3.5 text-muted-foreground" />
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            disabled={off}
            onClick={() => setMode(m.id)}
            className={cn(
              'rounded-full border px-row py-inset text-sm disabled:opacity-40',
              mode === m.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-card',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-cluster">
        <label className="flex items-center gap-cluster text-sm">
          <input type="checkbox" checked={repeat} disabled={off} onChange={(e) => setRepeat(e.target.checked)} />
          Repeat until a stop time
        </label>
        {repeat && (
          <div className="flex flex-wrap items-center gap-cluster text-row-sub">
            <RepeatIcon className="size-3.5" />
            <label className="flex items-center gap-cluster">
              Every
              <Input
                type="number"
                min={1}
                max={L.scheduleMaxSpanSec / 60}
                value={everyMin}
                onChange={(e) => setEveryMin(e.target.value)}
                aria-label="Every how many minutes"
                className="w-16"
              />
              min
            </label>
            <label className="flex items-center gap-cluster">
              until
              <Input
                type="time"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                aria-label="Stop time"
                className="w-28"
              />
            </label>
            <span>(1 min to 2 h apart, for 2 h at most)</span>
          </div>
        )}
      </div>

      {person && (
        <div
          data-testid="prank-limit"
          className={cn('flex items-center gap-inset text-row-sub', person.hourCount >= L.perTargetPerHour - 3 && 'text-ember')}
        >
          <AlertIcon className="size-3.5 shrink-0" />
          {person.hourCount} of {L.perTargetPerHour} this hour for {person.name} · {L.soundGapSec} s between sounds
        </div>
      )}

      <div className="flex flex-wrap items-center gap-row">
        <Button onClick={submit} disabled={!canSend}>
          {repeat && intervalOk ? `Repeat ${intervalWords(minutes * 60)}` : 'Send'}
        </Button>
        <Button variant="outline" onClick={onStopRepeats} disabled={!person || repeatsRunning === 0}>
          Stop
        </Button>
        {person && repeatsRunning > 0 && (
          <span className="text-row-sub">
            {repeatsRunning} {repeatsRunning === 1 ? 'repeat' : 'repeats'} running on {person.name}
          </span>
        )}
      </div>
    </div>
  );
}
