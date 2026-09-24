'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, CloseIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { groupRows, type TabSheetRow } from '@/lib/tabPick';

/** The Source sheet (docs/tabs-v3.md section 6, candidate B, the owner's
 *  pick): every tab Ember has for a song, in rank order, as a side sheet on
 *  desktop and a bottom sheet on phone. Choosing one draws it.
 *
 *  Presentational: rows come from lib/tabPick.ts sheetRows(), actions are
 *  callbacks. The design gallery renders the very same component with mock
 *  rows (components/library/options/tabs/FoundOnlineSection.tsx). */

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
  rows: TabSheetRow[];
  /** Ember is looking online right now: the sites and two placeholders. */
  searching?: boolean;
  /** Said when there is nothing to list. */
  emptyNote?: string;
  /** Two bars of the tab under a row, for the gallery's preview. */
  previewOf?: (row: TabSheetRow) => string | null;
  /** Over the whole window (the app) or inside the nearest positioned box
   *  (the design gallery's shell preview). */
  position?: 'fixed' | 'absolute';
  onPick: (id: string) => void;
  onClose: () => void;
  onLineUp?: (id: string) => void;
  onDelete?: (id: string) => void;
  actions?: TabSheetAction[];
}

/** "Lined up 94%" in ember, or a quiet "Not lined up yet". */
function StatusBadge({ row }: { row: TabSheetRow }) {
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

function SourceCard({
  row,
  preview,
  onPick,
  onLineUp,
  onDelete,
}: {
  row: TabSheetRow;
  preview?: string | null;
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

  return (
    <div
      data-testid="tab-source-row"
      data-tab-id={row.id}
      className={cn(
        'min-w-0 rounded-xl border transition-colors',
        row.drawn ? 'border-ember/40 bg-card' : 'border-border hover:bg-card',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={row.drawn}
        onClick={onPick}
        className="block w-full min-w-0 rounded-xl p-row text-left"
      >
        <span className="flex min-w-0 items-center justify-between gap-row">
          <span className="text-eyebrow min-w-0 truncate">{row.type}</span>
          <StatusBadge row={row} />
        </span>
        <span title={row.name} className={cn('mt-inset line-clamp-2 break-words text-sm font-semibold', row.drawn && 'text-ember')}>
          {row.name}
        </span>
        {row.badge && (
          <span className="mt-inset inline-flex items-center gap-inset text-[11px] font-medium text-ember">
            <CheckIcon className="size-3 shrink-0" />
            {row.badge}
          </span>
        )}
        {(row.rating || row.addedBy) && (
          <span className="text-meta mt-inset block min-w-0 truncate">{row.rating || row.addedBy}</span>
        )}
        {row.instruments.length > 0 && (
          <span className="mt-cluster flex min-w-0 flex-wrap gap-inset">
            {row.instruments.map((i) => (
              <span
                key={i}
                title={i}
                className="max-w-full truncate rounded-full bg-muted px-cluster py-inset text-[11px] text-muted-foreground"
              >
                {i}
              </span>
            ))}
          </span>
        )}
        {row.confidence !== null && (
          <span className="mt-cluster flex items-center gap-cluster text-[11px] text-muted-foreground">
            <span className="relative h-1 min-w-0 flex-1 rounded-full bg-muted">
              <span
                className={cn('absolute inset-y-0 left-0 rounded-full', row.linedUp ? 'bg-ember' : 'bg-muted-foreground/60')}
                style={{ width: `${Math.max(0, Math.min(100, row.confidence))}%` }}
              />
            </span>
            <span className="shrink-0 tabular-nums">{row.confidence}% sure</span>
          </span>
        )}
        {preview && (
          <span
            aria-hidden
            className="mt-cluster block overflow-hidden whitespace-pre rounded-md bg-background/60 p-cluster font-mono text-[10px] leading-3 text-muted-foreground"
          >
            {preview}
          </span>
        )}
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
  const online = p.rows.filter((r) => r.group !== 'server').length;

  const summary = p.searching
    ? 'Looking online…'
    : p.rows.length > 0
      ? `${p.rows.length} tab${p.rows.length === 1 ? '' : 's'}, ${online} found online`
      : (p.emptyNote ?? 'Nothing found online');

  const body = (
    <>
      <div className="flex shrink-0 items-start justify-between gap-row px-block pt-block">
        <div className="min-w-0">
          <div className="text-eyebrow">Tabs for this song</div>
          <div className="min-w-0 truncate font-semibold">
            {p.title}
            {p.artist && <span className="font-normal text-muted-foreground"> · {p.artist}</span>}
          </div>
          <div className="text-meta mt-inset min-w-0 truncate">{summary}</div>
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
      <div
        role="radiogroup"
        aria-label="Tabs for this song"
        className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto overflow-x-hidden px-block py-block"
      >
        {p.searching && (
          <div className="flex flex-col gap-row">
            <SiteChecks />
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        )}
        {!p.searching && p.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">{p.emptyNote ?? 'Nothing found online for this song yet.'}</p>
        )}
        {groupRows(p.rows).map((g) => (
          <div key={g.group} className="flex min-w-0 flex-col gap-cluster">
            <div className="text-eyebrow">{g.label}</div>
            {g.rows.map((row) => (
              <SourceCard
                key={row.id}
                row={row}
                preview={p.previewOf?.(row) ?? null}
                onPick={() => p.onPick(row.id)}
                onLineUp={p.onLineUp && (() => p.onLineUp!(row.id))}
                onDelete={p.onDelete && (() => p.onDelete!(row.id))}
              />
            ))}
          </div>
        ))}
      </div>
      {p.actions && p.actions.length > 0 && (
        <div className="flex min-w-0 shrink-0 flex-wrap gap-cluster border-t border-border px-block py-row">
          {p.actions.map((a) => (
            <Button key={a.id} size="sm" variant={a.variant ?? 'outline'} disabled={a.disabled} onClick={a.onClick} className="min-w-0">
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
