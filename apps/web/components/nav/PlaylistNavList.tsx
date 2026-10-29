import Link from 'next/link';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { countLabel, playlistCover } from '@/lib/collections';
import { ProgressRing } from '@/components/primitives/ProgressRing';
import { PeopleIcon } from '@/components/icons';
import { PinIcon } from '@/components/icons';
import { useHold } from '@/hooks/useHold';
import { cn } from '@/lib/utils';
import { formatCount } from '@/lib/format';
import type { NavImportState } from '@/lib/import/nav';

export type { NavImportState };

export interface PlaylistNavListProps {
  items: {
    id: string;
    name: string;
    href: string;
    artworkUrl?: string | null;
    trackArtworks?: string[];
    trackCount?: number;
    importState?: NavImportState;
    /** A collaborative playlist: "Collaborative" (yours) or "Shared by
     *  Olga", shown as a small people mark and its tooltip. */
    sharedLabel?: string;
    /** Held at the top of the list; shows a small pin. */
    pinned?: boolean;
  }[];
  /** Bigger rows with bigger covers (the head unit's covers sidebar). */
  covers?: boolean;
  /** Desktop sidebar only: rows 2px taller (7px padding). */
  roomy?: boolean;
  /** Signed-out users see "Sign in to create" instead of an (always empty) list. */
  authed: boolean;
  /** Highlights the open playlist. */
  activePath?: string;
  onNavigate?: () => void;
  /** A row was tapped (it moves up the recents order). */
  onOpen?: (id: string) => void;
  /** Long-press (touch) or right-click (desktop) on a row. */
  onTogglePin?: (id: string) => void;
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
    <span className="inline-flex shrink-0 items-center gap-inset text-[11px] text-ember" title={`${formatCount(state.count, 'song')} to review`}>
      <span className="size-1.5 rounded-full bg-ember" />
      {state.count} to review
    </span>
  );
}

/** Presentational only: no data fetching, no store reads. The "Playlists"
 *  link list under the collections nav in Sidebar and Drawer; each keeps
 *  its own wrapping element since the scroll container differs (ScrollArea
 *  vs a plain scrolling div). Rows have a cover and two lines at a fixed
 *  height (44px) and never shrink: the scroller around them scrolls instead. A playlist being imported shows its
 *  progress ring and count; one with songs left to check says how many. */
export function PlaylistNavList({ items, authed, activePath, onNavigate, onOpen, onTogglePin, covers = false, roomy = false }: PlaylistNavListProps) {
  const hold = useHold((id) => onTogglePin?.(id));
  return (
    <>
      {!authed && <div className="text-sm text-sidebar-foreground/55 px-3 py-2">Sign in to create</div>}
      {items.map((p) => (
        <Link
          key={p.id}
          href={p.href}
          onClick={(e) => {
            if (onTogglePin && hold.consumeHold()) {
              e.preventDefault();
              return;
            }
            onOpen?.(p.id);
            onNavigate?.();
          }}
          data-testid={p.importState ? 'import-nav-row' : 'playlist-nav-row'}
          data-import={p.importState?.kind}
          data-pinned={p.pinned || undefined}
          title={p.sharedLabel ? `${p.name}, ${p.sharedLabel}` : undefined}
          {...(onTogglePin ? hold.props(p.id) : {})}
          className={cn(
            covers
              ? 'flex shrink-0 items-center gap-row px-cluster py-inset rounded-md text-base transition-colors select-none'
              : 'flex shrink-0 items-center gap-row min-h-11 px-cluster rounded-md text-sm transition-colors select-none',
            !covers && (roomy ? 'py-[7px]' : 'py-1.5'),
            activePath === p.href
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
          )}
        >
          <CollectionCover
            {...playlistCover(p.artworkUrl ?? null, p.trackArtworks)}
            icon={null}
            className={cn('shrink-0 rounded-[4px] shadow-none', covers ? 'size-art-sm' : 'size-8')}
          />
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate text-sidebar-foreground', covers ? 'text-base' : 'text-[14.5px] leading-4')}>{p.name}</span>
            <span className="block truncate text-xs leading-4 text-sidebar-foreground/55">
              Playlist{typeof p.trackCount === 'number' ? ` · ${countLabel(p.trackCount)}` : ''}
            </span>
          </span>
          {p.sharedLabel && !p.importState && (
            <PeopleIcon data-testid="nav-shared" aria-label={p.sharedLabel} className="size-3.5 shrink-0 text-sidebar-foreground/55" />
          )}
          {p.importState && <ImportTail state={p.importState} />}
          {p.pinned && <PinIcon aria-label="Pinned" className="size-3.5 shrink-0 rotate-45 text-ember" />}
        </Link>
      ))}
    </>
  );
}
