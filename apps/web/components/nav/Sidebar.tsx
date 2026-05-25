'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteCreatePlaylist, useQueryPlaylists } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HomeIcon, SearchIcon, LibraryIcon, PlusIcon, LogOutIcon, FlameIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/search', label: 'Search', icon: SearchIcon },
  { href: '/library', label: 'Library', icon: LibraryIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: playlists = [] } = useQueryPlaylists();
  const createPlaylist = useExecuteCreatePlaylist();

  const create = async () => {
    const name = window.prompt('Playlist name?');
    if (!name) return;
    const playlist = await createPlaylist.mutateAsync(name);
    router.push(`/playlist/${playlist.id}`);
  };

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-5 pb-4">
        <FlameIcon className="h-5 w-5 text-ember" />
        <span className="text-lg font-bold tracking-tight">Ember</span>
      </div>

      <nav className="px-2 flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 px-4 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-sidebar-foreground/55">Playlists</span>
        {user && (
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={create} title="New playlist">
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 mt-2">
        <div className="px-2 pb-3 flex flex-col gap-0.5">
          {!user && <div className="text-sm text-sidebar-foreground/55 px-3 py-2">Sign in to create</div>}
          {playlists.map((p) => (
            <Link
              key={p.id}
              href={`/playlist/${p.id}`}
              className="px-3 py-2 rounded-md text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 truncate"
            >
              {p.name}
            </Link>
          ))}
        </div>
      </ScrollArea>

      {user && (
        <div className="mt-auto border-t border-sidebar-border px-2 py-3">
          <div className="flex items-center gap-3 px-2 py-2 min-w-0">
            <div className="h-7 w-7 rounded-full bg-ember text-white grid place-items-center text-xs font-bold shrink-0">
              {user.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="text-xs text-sidebar-foreground/70 truncate" title={user.email}>
              {user.email}
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="mt-1 w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOutIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
