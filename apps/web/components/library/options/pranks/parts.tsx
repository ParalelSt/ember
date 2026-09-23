'use client';

import { useState, type ReactNode } from 'react';
import { AlertIcon, CheckIcon, ClockIcon, RepeatIcon, ShieldIcon, UploadIcon, VolumeIcon, XCircleIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  MOCK_PRANK_HOUR_CAP,
  MOCK_PRANK_HOUR_COUNT,
  MOCK_PRANK_SCHEDULE,
  type MockPrankLogEntry,
  type MockPrankPerson,
} from '@/app/(app)/dizajn/mock';

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

/** What a person's row says, in plain words, never an id (plan section 4):
 *  "Luka is listening to Beggin' by Måneskin, for 2 min", "Nina, idle". */
export function personLine(p: MockPrankPerson): string {
  if (p.status === 'listening' && p.track) {
    return `${p.name} is listening to ${p.track.title} by ${p.track.artist}, for ${p.sinceLabel}`;
  }
  if (p.status === 'paused' && p.track) {
    return `${p.name} has ${p.track.title} by ${p.track.artist} paused, ${p.sinceLabel}`;
  }
  if (p.status === 'offline') {
    return `${p.name}, offline (last seen ${p.sinceLabel})`;
  }
  return `${p.name}, idle`;
}

export function PersonDot({ status }: { status: MockPrankPerson['status'] }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        status === 'listening' && 'bg-ember',
        status === 'paused' && 'bg-muted-foreground',
        (status === 'idle' || status === 'offline') && 'bg-border',
      )}
    />
  );
}

/** One person row: dot, plain-words line, position when listening or
 *  paused. Shared by all three candidates so the wording never drifts
 *  between them. */
export function PersonRow({
  person,
  selected,
  onSelect,
}: {
  person: MockPrankPerson;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="prank-person-row"
      data-person={person.id}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-row rounded-lg px-row py-cluster text-left transition-colors',
        selected ? 'bg-card' : 'hover:bg-card/60',
      )}
    >
      <PersonDot status={person.status} />
      <span className="min-w-0 flex-1">
        <div className="truncate text-row-title">{person.name}</div>
        <div className="truncate text-row-sub">{personLine(person)}</div>
      </span>
      {(person.status === 'listening' || person.status === 'paused') && person.track && person.positionSec != null && (
        <span className="text-row-sub tabular-nums">
          {fmtTime(person.positionSec)} / {fmtTime(person.track.durationSec)}
        </span>
      )}
    </button>
  );
}

export function GlobalSwitchRow({ on }: { on: boolean }) {
  return (
    <div data-testid="prank-global-switch" className="flex items-center justify-between gap-row rounded-lg border border-border px-row py-cluster">
      <div className="flex items-center gap-cluster">
        <ShieldIcon className="h-4 w-4 shrink-0" />
        <div>
          <div className="text-row-title">Pranks are {on ? 'on' : 'off'}</div>
          <div className="text-row-sub">{on ? 'Every admin can prank a friend.' : 'Nobody can be pranked right now.'}</div>
        </div>
      </div>
      <span
        role="switch"
        aria-checked={on}
        aria-label="Pranks global switch"
        className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', on ? 'bg-ember' : 'bg-muted')}
      >
        <span className={cn('inline-block h-4 w-4 rounded-full bg-background transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
      </span>
    </div>
  );
}

export function LimitNote({ tight }: { tight: boolean }) {
  return (
    <div data-testid="prank-limit-note" className={cn('flex items-center gap-inset text-row-sub', tight && 'text-ember')}>
      <AlertIcon className="h-3.5 w-3.5 shrink-0" />
      {MOCK_PRANK_HOUR_COUNT} of {MOCK_PRANK_HOUR_CAP} this hour for this person &middot; 15 s gap between sounds
    </div>
  );
}

export function ScheduleBanner({ onStop }: { onStop?: () => void }) {
  const s = MOCK_PRANK_SCHEDULE;
  return (
    <div data-testid="prank-schedule-banner" className="flex flex-wrap items-center justify-between gap-row rounded-lg border border-ember/40 bg-ember/10 px-row py-cluster">
      <div className="flex items-center gap-cluster">
        <RepeatIcon className="h-4 w-4 shrink-0 text-ember" />
        <div>
          <div className="text-row-title">&ldquo;{s.soundName}&rdquo; on {s.personName}, every {s.intervalMin} min until {s.untilLabel}</div>
          <div className="text-row-sub">Fired {s.fired} times so far.</div>
        </div>
      </div>
      <button type="button" onClick={onStop} className="rounded-full border border-border px-row py-inset text-sm font-medium hover:bg-card">
        Stop
      </button>
    </div>
  );
}

export function SoundLibraryList({
  sounds,
  selectedId,
  onSelect,
}: {
  sounds: { id: string; kind: 'sound' | 'song'; name: string; durationSec: number }[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <div data-testid="prank-sound-library" className="flex flex-col gap-block">
      <div className="flex items-center justify-between gap-row">
        <div className="text-eyebrow">Library</div>
        <button type="button" className="flex items-center gap-inset rounded-full border border-border px-row py-inset text-sm font-medium hover:bg-card">
          <UploadIcon className="h-3.5 w-3.5" />
          Upload
        </button>
      </div>
      <div className="flex flex-col gap-inset">
        {sounds.map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid="prank-sound-row"
            data-sound={s.id}
            onClick={() => onSelect?.(s.id)}
            className={cn(
              'flex items-center justify-between gap-row rounded-md px-row py-inset text-left text-sm transition-colors',
              selectedId === s.id ? 'bg-ember/15 text-foreground' : 'hover:bg-card',
            )}
          >
            <span className="min-w-0 truncate">
              {s.name}
              <span className="text-row-sub"> &middot; {s.kind === 'sound' ? 'sound' : 'song'}</span>
            </span>
            <span className="text-row-sub tabular-nums">{fmtTime(s.durationSec)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function logIcon(status: MockPrankLogEntry['status']) {
  if (status === 'done') return <CheckIcon className="h-3.5 w-3.5 shrink-0 text-ember" />;
  if (status === 'skipped' || status === 'expired') return <XCircleIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  return <ClockIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function LogTable({ entries }: { entries: MockPrankLogEntry[] }) {
  return (
    <div data-testid="prank-log" className="flex flex-col gap-inset">
      {entries.map((e) => (
        <div key={e.id} data-testid="prank-log-row" data-status={e.status} className="flex items-start gap-cluster py-inset text-sm">
          {logIcon(e.status)}
          <span className="min-w-0 flex-1 text-row-sub">{e.line}</span>
        </div>
      ))}
    </div>
  );
}

export function StopEverythingButton() {
  return (
    <button
      type="button"
      data-testid="prank-stop-everything"
      className="rounded-full border border-border px-row py-inset text-sm font-medium text-muted-foreground hover:bg-card"
    >
      Stop everything
    </button>
  );
}

export function ComposeVolumeRow() {
  return (
    <div className="flex items-center gap-cluster text-row-sub">
      <VolumeIcon className="h-3.5 w-3.5" />
      Duck music to 30% while it plays
    </div>
  );
}

export function RepeatRow({ intervalMin, untilLabel }: { intervalMin: number; untilLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-cluster text-row-sub">
      <RepeatIcon className="h-3.5 w-3.5" />
      Repeat every {intervalMin} min until {untilLabel}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-inset">
      <div className="text-eyebrow">{label}</div>
      {children}
    </div>
  );
}

export type PrankKindChoice = 'sound' | 'swap';
export type PrankSourceTab = 'library' | 'catalogue';

const KIND_PILLS: { id: PrankKindChoice; label: string }[] = [
  { id: 'sound', label: 'Play a sound' },
  { id: 'swap', label: 'Swap the song' },
];

function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-inset">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-full border px-row py-inset text-sm disabled:opacity-40',
            value === o.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-card',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface ComposerCardProps {
  person: MockPrankPerson | null;
  sounds: { id: string; kind: 'sound' | 'song'; name: string; durationSec: number }[];
  catalogue: { id: string; title: string; artist: string }[];
  disabled: boolean;
  repeating?: boolean;
}

/** The whole job of composing one prank: kind, a sound picked by name from
 *  the library or any catalogue song, repeat every N minutes until a time,
 *  the limit that bites, Send and Stop. Shared by every candidate so the
 *  fields never drift; only the surrounding card differs. */
export function ComposerCard({ person, sounds, catalogue, disabled, repeating }: ComposerCardProps) {
  const [kind, setKind] = useState<PrankKindChoice>('sound');
  const [sourceTab, setSourceTab] = useState<PrankSourceTab>('library');
  const [soundId, setSoundId] = useState<string | null>(sounds[0]?.id ?? null);
  const [repeat, setRepeat] = useState(!!repeating);

  const filtered = sounds.filter((s) => (kind === 'sound' ? s.kind === 'sound' : s.kind === 'song'));

  return (
    <div data-testid="prank-composer" className="flex flex-col gap-block rounded-lg border border-border p-row">
      <div className="text-row-title">{person ? `Compose for ${person.name}` : 'Pick a person to compose a prank'}</div>

      <PillGroup label="Kind" options={KIND_PILLS} value={kind} onChange={setKind} disabled={disabled || !person} />

      {kind === 'sound' && <ComposeVolumeRow />}

      <Field label={kind === 'sound' ? 'Sound' : 'Song to swap in'}>
        <div className="flex flex-col gap-cluster">
          <div role="radiogroup" aria-label="Source" className="flex gap-inset">
            <button
              type="button"
              role="radio"
              aria-checked={sourceTab === 'library'}
              disabled={disabled || !person}
              onClick={() => setSourceTab('library')}
              className={cn('rounded-full px-row py-inset text-sm', sourceTab === 'library' ? 'bg-card font-medium' : 'text-muted-foreground')}
            >
              Library
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={sourceTab === 'catalogue'}
              disabled={disabled || !person}
              onClick={() => setSourceTab('catalogue')}
              className={cn('rounded-full px-row py-inset text-sm', sourceTab === 'catalogue' ? 'bg-card font-medium' : 'text-muted-foreground')}
            >
              Any song, by name
            </button>
          </div>
          {sourceTab === 'library' ? (
            <SoundLibraryList sounds={filtered} selectedId={soundId} onSelect={setSoundId} />
          ) : (
            <div className="flex flex-col gap-inset">
              {catalogue.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid="prank-catalogue-row"
                  disabled={disabled || !person}
                  className="flex items-center justify-between rounded-md px-row py-inset text-left text-sm hover:bg-card disabled:opacity-40"
                >
                  <span className="min-w-0 truncate">
                    {c.title} <span className="text-row-sub">by {c.artist}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Field>

      <div className="flex flex-col gap-cluster">
        <label className="flex items-center gap-cluster text-sm">
          <input type="checkbox" checked={repeat} disabled={disabled || !person} onChange={(e) => setRepeat(e.target.checked)} />
          Repeat until a stop time
        </label>
        {repeat && <RepeatRow intervalMin={5} untilLabel="22:00" />}
      </div>

      {person && <LimitNote tight={MOCK_PRANK_HOUR_COUNT >= MOCK_PRANK_HOUR_CAP - 3} />}

      <div className="flex items-center gap-row">
        <button type="button" disabled={disabled || !person} className="rounded-full bg-foreground px-row py-inset text-sm font-medium text-background disabled:opacity-40">
          Send
        </button>
        <button type="button" disabled={disabled || !person} className="rounded-full border border-border px-row py-inset text-sm font-medium text-muted-foreground disabled:opacity-40">
          Stop
        </button>
      </div>
    </div>
  );
}
