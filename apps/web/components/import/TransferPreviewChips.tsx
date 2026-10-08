'use client';

import { useState, type ReactNode } from 'react';
import { ClockIcon } from '@/components/icons';
import type { JobKind } from '@/lib/import/types';
import { cn } from '@/lib/utils';

// "Before you start" on the Transfer page: the count as one huge number,
// where the songs go and about how long under it, the counts as chips that
// show which songs they mean, and Skip already liked as a switch.
// Presentational: data in, callbacks out.

export interface SongName {
  title: string;
  artist: string;
}

export interface CountChip {
  id: 'new' | 'liked' | 'double' | 'bad' | 'over' | 'check';
  label: string;
  /** How many songs the chip counts, for "and N more". */
  count: number;
  /** The first few songs it means. */
  songs?: SongName[];
  /** Said instead of (or under) a list, when the songs cannot be named. */
  note?: string;
}

export interface PreviewChipsProps {
  /** The service's mark, the source's name and a second line under it. */
  mark: ReactNode;
  label: string;
  detail: string;
  /** Songs the Start button would bring over. */
  total: number;
  /** "About 15 minutes". */
  estimate: string;
  chips: CountChip[];
  destination: JobKind;
  /** Skip already liked: offered only when some are. */
  skip: { available: boolean; on: boolean; onToggle: () => void };
  /** How the songs are found, and that the page can be left. */
  note: string;
  /** Warnings and refusals, under the chips. */
  children?: ReactNode;
}

export function PreviewChips({ mark, label, detail, total, estimate, chips, destination, skip, note, children }: PreviewChipsProps) {
  const [open, setOpen] = useState<CountChip['id'] | null>(null);
  const picked = chips.find((c) => c.id === open) ?? null;
  return (
    <div data-testid="transfer-preview" className="flex flex-col gap-row">
      <div className="flex flex-col items-center gap-inset px-inset pt-row text-center">
        <span className="inline-flex max-w-full items-center gap-cluster rounded-full border border-border py-inset pl-inset pr-row text-[12.5px] text-muted-foreground">
          {mark}
          <span className="truncate">
            {label} · {detail}
          </span>
        </span>
        <div
          data-testid="transfer-preview-count"
          className="mt-block bg-gradient-to-b from-foreground from-30% to-ember-soft bg-clip-text pb-inset text-[80px] font-bold leading-none tracking-[-0.045em] tabular-nums text-transparent"
        >
          {total.toLocaleString('en-GB')}
        </div>
        <p data-testid="transfer-preview-sentence" className="text-[15px] font-medium">
          {total === 1 ? 'song' : 'songs'} to bring into {destination === 'liked' ? 'your Liked songs' : 'a new playlist'}
        </p>
        {estimate && (
          <p data-testid="transfer-preview-time" className="mt-inset inline-flex items-center gap-inset text-[13px] text-muted-foreground">
            <ClockIcon className="h-3.5 w-3.5" />
            {estimate}, you can leave while it runs
          </p>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap justify-center gap-cluster">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid="transfer-chip"
              data-chip={c.id}
              aria-expanded={open === c.id}
              onClick={() => setOpen(open === c.id ? null : c.id)}
              className={cn(
                'inline-flex h-8 items-center gap-inset whitespace-nowrap rounded-full border px-row text-xs transition-colors',
                open === c.id ? 'border-ember/50 bg-ember/15 text-ember' : 'border-border hover:bg-card',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {picked && (
        <div data-testid="transfer-chip-songs" className="rounded-xl border border-border px-row py-cluster">
          {picked.songs && picked.songs.length > 0 && (
            <ul className="flex flex-col">
              {picked.songs.map((s, i) => (
                <li key={`${s.title}-${i}`} className="flex min-h-10 flex-col justify-center py-inset">
                  <span className="truncate text-sm">{s.title}</span>
                  {s.artist && <span className="truncate text-xs text-muted-foreground">{s.artist}</span>}
                </li>
              ))}
              {picked.count > picked.songs.length && (
                <li className="py-inset text-xs text-muted-foreground">
                  and {(picked.count - picked.songs.length).toLocaleString('en-GB')} more
                </li>
              )}
            </ul>
          )}
          {picked.note && <p className="py-inset text-xs text-muted-foreground">{picked.note}</p>}
        </div>
      )}

      {children}

      {skip.available && (
        <button
          type="button"
          role="switch"
          data-testid="transfer-skip-liked"
          aria-checked={skip.on}
          onClick={skip.onToggle}
          className="flex w-full items-center gap-row rounded-xl border border-border px-row py-cluster text-left transition-colors hover:bg-card"
        >
          <span className="min-w-0 flex-1 text-sm">Skip songs I already like</span>
          <span
            aria-hidden="true"
            className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', skip.on ? 'bg-ember' : 'bg-muted')}
          >
            <span
              className={cn(
                'absolute left-1 top-1 size-4 rounded-full bg-background transition-transform',
                skip.on && 'translate-x-5',
              )}
            />
          </span>
        </button>
      )}

      <p className="text-center text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
