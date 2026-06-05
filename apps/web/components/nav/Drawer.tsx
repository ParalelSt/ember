'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteAddToPlaylist, useExecuteCreatePlaylist, useQueryPlaylists } from '@/hooks/useLibrary';
import type { Track } from '@/types/track';
import { CreatePlaylistDialog } from '@/components/track/CreatePlaylistDialog';
import { HomeIcon, SearchIcon, LibraryIcon, PlusIcon, FlameIcon, SettingsIcon, ShieldIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

const BASE_NAV = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/search', label: 'Search', icon: SearchIcon },
  { href: '/library', label: 'Library', icon: LibraryIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Drawer({ open, onOpenChange }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, name: displayName, avatarUrl, isAdmin } = useAuth();
  const NAV = isAdmin
    ? [...BASE_NAV, { href: '/admin', label: 'Admin', icon: ShieldIcon }]
    : BASE_NAV;
  const { data: playlists = [] } = useQueryPlaylists();
  const createPlaylist = useExecuteCreatePlaylist();
  const addToPlaylist = useExecuteAddToPlaylist();
  const [createOpen, setCreateOpen] = useState(false);

  const close = () => onOpenChange(false);

  const handleCreate = async (name: string, tracks: Track[]) => {
    try {
      const playlist = await createPlaylist.mutateAsync(name);
      for (const t of tracks) {
        await addToPlaylist.mutateAsync({ id: playlist.id, track: t });
      }
      toast.success(tracks.length ? `Created "${playlist.name}" with ${tracks.length} track${tracks.length === 1 ? '' : 's'}` : `Created "${playlist.name}"`);
      close();
      router.push(`/playlist/${playlist.id}`);
    } catch (e) {
      toast.error(`Couldn't create playlist: ${(e as Error).message}`);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 max-w-[82vw] flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border p-0">
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="text-base">
            <Link
              href="/"
              onClick={close}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              aria-label="Home"
            >
              <FlameIcon className="h-4 w-4 text-ember" />
              Ember
            </Link>
          </SheetTitle>
        </SheetHeader>

        <nav className="px-2 py-3 flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={close}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium',
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

        <div className="px-4 flex items-center justify-between border-t border-sidebar-border pt-3">
          <span className="text-[11px] uppercase tracking-widest text-sidebar-foreground/55">Playlists</span>
          {user && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setCreateOpen(true)} title="New playlist">
              <PlusIcon className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
          {!user && <div className="text-sm text-sidebar-foreground/55 px-3 py-2">Sign in to create</div>}
          {playlists.map((p) => (
            <Link
              key={p.id}
              href={`/playlist/${p.id}`}
              onClick={close}
              className="px-3 py-2 rounded-md text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 truncate"
            >
              {p.name}
            </Link>
          ))}
        </div>

        {user && (
          <div className="border-t border-sidebar-border px-2 py-3">
            <Link
              href="/settings/profile"
              onClick={close}
              className="flex items-center gap-3 px-2 py-2 min-w-0 rounded-md hover:bg-sidebar-accent/60"
            >
              <div className="relative h-7 w-7 rounded-full overflow-hidden bg-ember text-white grid place-items-center text-xs font-bold shrink-0">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  (displayName || user.email)[0]?.toUpperCase() ?? '?'
                )}
              </div>
              <div className="text-xs text-sidebar-foreground/70 truncate" title={user.email}>
                {displayName || user.email}
              </div>
            </Link>
          </div>
        )}
      </SheetContent>
      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
    </Sheet>
  );
}
