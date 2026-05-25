'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlusIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  useExecuteAddToPlaylist,
  useExecuteCreatePlaylist,
  useQueryPlaylists,
} from '@/hooks/useLibrary';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

export function AddToPlaylistMenu({ track }: { track: Track }) {
  const { user } = useAuth();
  const { data: playlists = [] } = useQueryPlaylists();
  const addToPlaylist = useExecuteAddToPlaylist();
  const createPlaylist = useExecuteCreatePlaylist();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const add = async (id: string) => {
    await addToPlaylist.mutateAsync({ id, track });
    setOpen(false);
  };

  const createAndAdd = async () => {
    const name = window.prompt('New playlist name?');
    if (!name) return;
    const playlist = await createPlaylist.mutateAsync(name);
    await addToPlaylist.mutateAsync({ id: playlist.id, track });
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
        )}
        onClick={(e) => e.stopPropagation()}
        aria-label="Add to playlist"
      >
        <PlusIcon className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={createAndAdd} className="text-ember font-semibold">
          <PlusIcon className="h-3.5 w-3.5" /> New playlist
        </DropdownMenuItem>
        {playlists.length > 0 && <DropdownMenuSeparator />}
        {playlists.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => add(p.id)} className="truncate">
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
