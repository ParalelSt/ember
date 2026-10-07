'use client';

import { useState, type ReactNode } from 'react';
import { CheckIcon } from '@/components/icons';
import type { JobKind } from '@/lib/import/types';
import { cn } from '@/lib/utils';

// "Before you start" on the Transfer page: one sentence with the count and
// about how long, the counts as chips that show which songs they mean, and
// the options as chips. Presentational: data in, callbacks out.

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
      <div className="flex items-center gap-row">
        {mark}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{label}</div>
          <div className="truncate text-xs text-muted-foreground">{detail}</div>
        </div>
      </div>

      <p data-testid="transfer-preview-sentence" className="text-base leading-snug">
        <b>
          {total.toLocaleString('en-GB')} {total === 1 ? 'song' : 'songs'}
        </b>{' '}
        to bring over
        {estimate && <span className="text-muted-foreground">, {estimate.toLowerCase()}</span>}.
      </p>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-cluster">
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

      <div className="text-eyebrow">Options</div>
      <div className="flex flex-wrap gap-cluster">
        {skip.available && (
          <button
            type="button"
            data-testid="transfer-skip-liked"
            aria-pressed={skip.on}
            onClick={skip.onToggle}
            className={cn(
              'inline-flex h-8 items-center gap-inset whitespace-nowrap rounded-full border px-row text-xs transition-colors',
              skip.on ? 'border-ember/50 bg-ember/15 text-ember' : 'border-border hover:bg-card',
            )}
          >
            {skip.on && <CheckIcon className="h-3.5 w-3.5" />}
            Skip already liked
          </button>
        )}
        <span className="inline-flex h-8 items-center whitespace-nowrap rounded-full border border-border px-row text-xs text-muted-foreground">
          Into {destination === 'liked' ? 'Liked songs' : 'a new playlist'}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
