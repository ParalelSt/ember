'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, DrumIcon, TabsIcon, UploadIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BEST_BADGE, PICK_BADGE } from '@/lib/tabPick';
import type { InstrumentChoice, VersionChoice } from '@/lib/tabChoose';

/** Choosing a tab, instrument first (the owner's pick): what you play as
 *  tiles with how many versions each has, then that instrument's versions,
 *  best match first, with Line it up and Delete on each and Add a file
 *  under them. A side sheet on desktop, a bottom sheet on phone.
 *
 *  Presentational: the tiles and rows come from lib/tabChoose.ts, actions
 *  are callbacks. */

/** One button under the list: "Search online again", "Add a file"... */
export interface TabSheetAction {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'outline' | 'ghost';
}

export interface TabSourceSheetProps {
  open: boolean;
  /** Bottom sheet instead of a side sheet. */
  phone: boolean;
  title: string;
  artist: string;
  instruments: InstrumentChoice[];
  /** The instrument whose versions are listed (its key). */
  instrument: string | null;
  onInstrument: (key: string) => void;
  /** That instrument's versions, best first. */
  versions: VersionChoice[];
  /** The version on screen, when it is this instrument's. */
  current: { id: string; track: number } | null;
  /** Ember is looking online right now: the sites and two placeholders. */
  searching?: boolean;
  /** Said when there is nothing to list. */
  emptyNote?: string;
  /** Over the whole window (the app) or inside the nearest positioned box. */
  position?: 'fixed' | 'absolute';
  onPick: (id: string, track: number) => void;
  onClose: () => void;
  onLineUp?: (id: string) => void;
  onDelete?: (id: string) => void;
  actions?: TabSheetAction[];
}

export function InstrumentIcon({ name, className }: { name: string; className?: string }) {
  return /drum|percussion/i.test(name) ? <DrumIcon className={className} /> : <TabsIcon className={className} />;
}

/** "Lined up 94%" in ember, or a quiet "Not lined up yet". */
function StatusBadge({ row }: { row: VersionChoice }) {
  return (
    <span
      data-testid="tab-source-status"
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-cluster py-inset text-[11px] font-medium leading-none',
        row.linedUp ? 'bg-ember/15 text-ember' : 'bg-muted text-muted-foreground',
      )}
    >
      {row.status}
    </span>
  );
}

/** Which sites Ember is checking, one at a time. */
function SiteChecks() {
  const rows = [
    { site: 'Songsterr', status: 'Checking…', active: true },
    { site: 'Ultimate Guitar', status: 'Next', active: false },
  ];
  return (
    <ul data-testid="tab-source-checks" className="flex flex-col gap-cluster">
      {rows.map((r) => (
        <li key={r.site} className="flex min-w-0 items-center gap-cluster text-xs">
          <span
            aria-hidden
            className={cn('size-1.5 shrink-0 rounded-full', r.active ? 'animate-pulse bg-ember' : 'bg-muted-foreground/40')}
          />
          <span className="shrink-0 font-medium text-foreground">{r.site}</span>
          <span className="min-w-0 truncate text-muted-foreground">{r.status}</span>
        </li>
      ))}
    </ul>
  );
}

function VersionRow({
  row,
  best,
  on,
  onPick,
  onLineUp,
  onDelete,
}: {
  row: VersionChoice;
  best: boolean;
  on: boolean;
  onPick: () => void;
  onLineUp?: () => void;
  onDelete?: () => void;
}) {
  const acts = [
    onLineUp && row.canLineUp
      ? { key: 'line-up', label: row.aligning ? 'Lining it up…' : 'Line it up', run: onLineUp, danger: false, off: row.aligning }
      : null,
    onDelete && row.canDelete ? { key: 'delete', label: 'Delete', run: onDelete, danger: true, off: false } : null,
  ].filter((a): a is { key: string; label: string; run: () => void; danger: boolean; off: boolean } => !!a);
  const detail = [row.source, row.type, row.rating || row.addedBy].filter(Boolean).join(' · ');

  return (
    <div
      data-testid="tab-source-row"
      data-tab-id={row.id}
      className={cn('min-w-0 rounded-xl border transition-colors', on ? 'border-ember/40 bg-card' : 'border-border hover:bg-card')}
    >
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={onPick}
        className="flex w-full min-w-0 items-center gap-row rounded-xl p-row text-left"
      >
        <span
          aria-hidden
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums',
            best ? 'bg-ember/15 text-ember' : 'bg-muted text-muted-foreground',
          )}
        >
          {row.rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-cluster gap-y-inset">
            <span title={row.name} className={cn('min-w-0 truncate text-sm font-semibold', on && 'text-ember')}>
              {row.name}
            </span>
            {best && <span className="shrink-0 rounded-full bg-ember/15 px-cluster py-inset text-[11px] font-medium leading-none text-ember">{BEST_BADGE}</span>}
            {row.badge === PICK_BADGE && (
              <span className="shrink-0 rounded-full bg-muted px-cluster py-inset text-[11px] font-medium leading-none text-foreground">{PICK_BADGE}</span>
            )}
          </span>
          <span className="text-meta block min-w-0 truncate">{detail}</span>
        </span>
        <StatusBadge row={row} />
      </button>
      {acts.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-inset border-t border-border/60 px-row py-cluster">
          {acts.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={a.off}
              onClick={a.run}
              className={cn(
                'min-w-0 max-w-full truncate rounded-full px-cluster py-inset text-[11px] font-medium transition-colors',
                a.danger ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                a.off && 'opacity-60',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TabSourceSheet(p: TabSourceSheetProps) {
  const fixed = (p.position ?? 'fixed') === 'fixed';
  const chosen = p.instruments.find((i) => i.key === p.instrument) ?? null;

  const body = (
    <>
      <div className="flex shrink-0 items-start justify-between gap-row px-block pt-block">
        <div className="min-w-0">
          <div className="text-eyebrow">What do you want to play?</div>
          <div className="min-w-0 truncate font-semibold">
            {p.title}
            {p.artist && <span className="font-normal text-muted-foreground"> · {p.artist}</span>}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close the tab list"
          onClick={p.onClose}
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto overflow-x-hidden px-block py-block">
        {p.instruments.length > 0 && (
          <div role="group" aria-label="Instrument" className="-mx-block flex gap-cluster overflow-x-auto px-block pb-inset">
            {p.instruments.map((i) => (
              <button
                key={i.key}
                type="button"
                aria-pressed={i.key === p.instrument}
                data-testid="tab-instrument-tile"
                onClick={() => p.onInstrument(i.key)}
                className={cn(
                  'flex w-24 shrink-0 flex-col items-center gap-inset rounded-xl border p-cluster text-center text-xs transition-colors',
                  i.key === p.instrument ? 'border-ember bg-ember/10 text-foreground' : 'border-border text-muted-foreground hover:bg-card',
                )}
              >
                <InstrumentIcon name={i.name} className="size-6" />
                <span className="line-clamp-2 font-medium">{i.name}</span>
                <small className="text-[10.5px] text-muted-foreground">
                  {i.count} version{i.count === 1 ? '' : 's'}
                </small>
              </button>
            ))}
          </div>
        )}
        {p.searching && (
          <div className="flex flex-col gap-row">
            <SiteChecks />
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        )}
        {!p.searching && p.instruments.length === 0 && (
          <p className="text-sm text-muted-foreground">{p.emptyNote ?? 'Nothing found online for this song yet.'}</p>
        )}
        {chosen && (
          <div role="radiogroup" aria-label={`${chosen.name}, best first`} className="flex min-w-0 flex-col gap-cluster">
            <div className="text-eyebrow">{chosen.name}, best first</div>
            {p.versions.map((row, i) => (
              <VersionRow
                key={row.id}
                row={row}
                best={i === 0 && p.versions.length > 1}
                on={!!p.current && p.current.id === row.id && p.current.track === row.track}
                onPick={() => p.onPick(row.id, row.track)}
                onLineUp={p.onLineUp && (() => p.onLineUp!(row.id))}
                onDelete={p.onDelete && (() => p.onDelete!(row.id))}
              />
            ))}
          </div>
        )}
      </div>
      {p.actions && p.actions.length > 0 && (
        <div className="flex min-w-0 shrink-0 flex-wrap gap-cluster border-t border-border px-block py-row">
          {p.actions.map((a) => (
            <Button key={a.id} size="sm" variant={a.variant ?? 'outline'} disabled={a.disabled} onClick={a.onClick} className="min-w-0">
              {a.id === 'add-file' && <UploadIcon className="size-3.5" />}
              <span className="min-w-0 truncate">{a.label}</span>
            </Button>
          ))}
        </div>
      )}
    </>
  );

  if (!p.open) return null;

  const sheet = p.phone ? (
    <div
      data-testid="tab-source-sheet"
      data-phone="true"
      className={cn('z-50 flex flex-col', fixed ? 'fixed inset-0' : 'absolute inset-0')}
    >
      <button type="button" aria-label="Close the tab list" onClick={p.onClose} className="h-[18%] shrink-0 bg-black/50" />
      <div
        role="dialog"
        aria-label="Choose a tab"
        className="safe-area-bottom flex min-h-0 min-w-0 flex-1 flex-col rounded-t-2xl border-t border-border bg-sidebar text-sidebar-foreground shadow-soft"
      >
        <div aria-hidden className="mx-auto mt-cluster h-1 w-10 shrink-0 rounded-full bg-muted" />
        {body}
      </div>
    </div>
  ) : (
    <aside
      data-testid="tab-source-sheet"
      data-phone="false"
      role="dialog"
      aria-label="Choose a tab"
      className={cn(
        'z-40 flex w-[min(420px,100vw)] flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground shadow-soft',
        fixed ? 'fixed inset-y-0 right-0' : 'absolute inset-y-0 right-0',
      )}
    >
      {body}
    </aside>
  );

  if (!fixed) return sheet;
  // Over the whole window, outside the page's scroller and its transforms.
  // The sheet only exists once someone opened it, so the server never
  // renders this branch and there is nothing to hydrate.
  if (typeof document === 'undefined') return null;
  return createPortal(sheet as ReactNode, document.body);
}
