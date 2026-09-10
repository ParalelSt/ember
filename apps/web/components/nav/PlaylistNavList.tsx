import Link from 'next/link';

export interface PlaylistNavListProps {
  items: { id: string; name: string; href: string }[];
  /** Signed-out users see "Sign in to create" instead of an (always empty) list. */
  authed: boolean;
  onNavigate?: () => void;
}

/** Presentational only: no data fetching, no store reads. The "Playlists"
 *  link list under the collections nav in Sidebar and Drawer; each keeps
 *  its own wrapping element since the scroll container differs (ScrollArea
 *  vs a plain scrolling div). */
export function PlaylistNavList({ items, authed, onNavigate }: PlaylistNavListProps) {
  return (
    <>
      {!authed && <div className="text-sm text-sidebar-foreground/55 px-3 py-2">Sign in to create</div>}
      {items.map((p) => (
        <Link
          key={p.id}
          href={p.href}
          onClick={onNavigate}
          className="px-3 py-2 rounded-md text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 truncate"
        >
          {p.name}
        </Link>
      ))}
    </>
  );
}
