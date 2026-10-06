'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreatePlaylistDialog } from '@/components/track/menus/CreatePlaylistDialog';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, PlusIcon, RefreshIcon } from '@/components/icons';
import type { TrackMoves } from './trackMoves';
import { useAuth } from '@/components/providers/AuthProvider';
import { formatCount } from '@/lib/format';
import {
  useExecuteAddToPlaylist,
  useExecuteCreatePlaylist,
  useQueryPlaylists,
  useQueryPlaylistsContaining,
} from '@/hooks/useLibrary';
import { isAlreadyInPlaylist } from '@/lib/playlistAdd';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

/** `onRematch`: the track came from an import, so on phones (where the row
 *  has no room for a separate More button) this menu also offers "Wrong
 *  song? Re-match". `moves` does the same for Move up / Move down on a
 *  playlist shown in its own order. `open`/`onOpenChange` let a parent open
 *  the menu from elsewhere; with `hiddenTrigger` the + button is only an
 *  invisible anchor for it (the full-screen player's More sheet opens it,
 *  just under its ⋯). */
export function AddToPlaylistMenu({
  track,
  onRematch,
  moves,
  open: openProp,
  onOpenChange,
  hiddenTrigger,
}: {
  track: Track;
  onRematch?: () => void;
  moves?: TrackMoves;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hiddenTrigger?: boolean;
}) {
  const { user } = useAuth();
  const { data: playlists = [] } = useQueryPlaylists();
  const addToPlaylist = useExecuteAddToPlaylist();
  const createPlaylist = useExecuteCreatePlaylist();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [createOpen, setCreateOpen] = useState(false);
  // The playlists that already have this song: marked "Added" and not
  // offered again. Asked for when the menu opens.
  const { data: containingIds } = useQueryPlaylistsContaining(track.id, open);
  const containing = new Set(containingIds ?? []);

  if (!user) return null;

  const add = async (id: string, playlistName: string) => {
    setOpen(false);
    try {
      await addToPlaylist.mutateAsync({ id, track });
      toast.success(`Added "${track.title}" to ${playlistName}`);
    } catch (e) {
      // Already there (the server's 409) is an answer, not a failure;
      // every other failure is real.
      if (isAlreadyInPlaylist(e)) toast.message(`Already in ${playlistName}`);
      else toast.error(`Couldn't add "${track.title}", please try again.`);
    }
  };

  const openCreate = () => {
    setOpen(false);     // close the menu so the dialog sits cleanly on top
    setCreateOpen(true);
  };

  // Dialog already has the current track pre-selected via initialTracks below,
  // so handleCreate just iterates over whatever the dialog returns.
  const handleCreate = async (name: string, tracks: Track[]) => {
    try {
      const playlist = await createPlaylist.mutateAsync(name);
      for (const t of tracks) {
        await addToPlaylist.mutateAsync({ id: playlist.id, track: t });
      }
      toast.success(`Created "${playlist.name}" with ${formatCount(tracks.length, 'track')}`);
    } catch (e) {
      toast.error(`Couldn't create the playlist, please try again.`);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
          hiddenTrigger && 'pointer-events-none opacity-0',
        )}
        onClick={(e) => e.stopPropagation()}
        aria-label="Add to playlist"
        aria-hidden={hiddenTrigger || undefined}
        tabIndex={hiddenTrigger ? -1 : undefined}
      >
        <PlusIcon className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56" onClick={(e) => e.stopPropagation()}>
        {moves?.up && (
          <DropdownMenuItem onClick={() => { setOpen(false); moves.up?.(); }} className="md:hidden">
            <ArrowUpIcon className="h-3.5 w-3.5" /> Move up
          </DropdownMenuItem>
        )}
        {moves?.down && (
          <DropdownMenuItem onClick={() => { setOpen(false); moves.down?.(); }} className="md:hidden">
            <ArrowDownIcon className="h-3.5 w-3.5" /> Move down
          </DropdownMenuItem>
        )}
        {onRematch && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onRematch();
            }}
            className="md:hidden"
          >
            <RefreshIcon className="h-3.5 w-3.5" /> Wrong song? Re-match
          </DropdownMenuItem>
        )}
        {(onRematch || moves?.up || moves?.down) && <DropdownMenuSeparator className="md:hidden" />}
        <DropdownMenuItem onClick={openCreate} className="text-ember font-semibold">
          <PlusIcon className="h-3.5 w-3.5" /> New playlist
        </DropdownMenuItem>
        {playlists.length > 0 && <DropdownMenuSeparator />}
        {playlists.map((p) => {
          const has = containing.has(p.id);
          return (
            <DropdownMenuItem
              key={p.id}
              onClick={has ? undefined : () => add(p.id, p.name)}
              disabled={has}
              className="truncate"
            >
              <span className="truncate">{p.name}</span>
              {has && (
                <span className="ml-auto flex shrink-0 items-center gap-inset text-xs text-muted-foreground">
                  <CheckIcon className="h-3.5 w-3.5" aria-hidden /> Added
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
      <CreatePlaylistDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
        initialTracks={[track]}
      />
    </DropdownMenu>
  );
}
