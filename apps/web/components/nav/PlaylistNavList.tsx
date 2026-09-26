import Link from 'next/link';
import { ProgressRing } from '@/components/primitives/ProgressRing';
import { PeopleIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { NavImportState } from '@/lib/import/nav';

export type { NavImportState };

export interface PlaylistNavListProps {
  items: {
    id: string;
    name: string;
    href: string;
    importState?: NavImportState;
    /** A collaborative playlist: "Collaborative" (yours) or "Shared by
     *  Olga", shown as a small people mark and its tooltip. */
    sharedLabel?: string;
  }[];
  /** Signed-out users see "Sign in to create" instead of an (always empty) list. */
  authed: boolean;
  /** Highlights the open playlist. */
  activePath?: string;
  onNavigate?: () => void;
}

/** The ring, the count or "Import failed" at the end of a nav row. Shared
 *  with CollectionNavList, whose Liked songs row wears it for a transfer. */
export function ImportTail({ state }: { state: NavImportState }) {
  if (state.kind === 'importing' || state.kind === 'paused') {
    return (
      <>
        <span className="shrink-0 text-[11px] tabular-nums text-sidebar-foreground/55">
          {state.kind === 'paused' ? 'Paused' : `${state.done} of ${state.total}`}
        </span>
        <ProgressRing done={state.done} total={state.total} size={14} label={`Importing, ${state.done} of ${state.total}`} />
      </>
    );
  }
  if (state.kind === 'failed') {
    return <span className="shrink-0 text-[11px] text-sidebar-foreground/55">Import failed</span>;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-inset text-[11px] text-ember" title={`${state.count} songs to review`}>
      <span className="size-1.5 rounded-full bg-ember" />
      {state.count} to review
    </span>
  );
}

/** Presentational only: no data fetching, no store reads. The "Playlists"
 *  link list under the collections nav in Sidebar and Drawer; each keeps
 *  its own wrapping element since the scroll container differs (ScrollArea
 *  vs a plain scrolling div). A playlist being imported shows its progress
 *  ring and count; one with songs left to check says how many. */
export function PlaylistNavList({ items, authed, activePath, onNavigate }: PlaylistNavListProps) {
  return (
    <>
      {!authed && <div className="text-sm text-sidebar-foreground/55 px-3 py-2">Sign in to create</div>}
      {items.map((p) => (
        <Link
          key={p.id}
          href={p.href}
          onClick={onNavigate}
          data-testid={p.importState ? 'import-nav-row' : undefined}
          data-import={p.importState?.kind}
          title={p.sharedLabel ? `${p.name}, ${p.sharedLabel}` : undefined}
          className={cn(
            'px-3 py-2 rounded-md text-sm truncate transition-colors',
            (p.importState || p.sharedLabel) && 'flex items-center gap-cluster',
            activePath === p.href
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
          )}
        >
          {p.importState ? (
            <>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <ImportTail state={p.importState} />
            </>
          ) : p.sharedLabel ? (
            <>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <PeopleIcon data-testid="nav-shared" aria-label={p.sharedLabel} className="size-3.5 shrink-0 text-sidebar-foreground/55" />
            </>
          ) : (
            p.name
          )}
        </Link>
      ))}
    </>
  );
}
