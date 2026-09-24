'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreatePlaylistDialog } from '@/components/track/menus/CreatePlaylistDialog';
import { MoreIcon, PlusIcon, RefreshIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { formatCount } from '@/lib/format';
import {
  useExecuteAddToPlaylist,
  useExecuteCreatePlaylist,
  useQueryPlaylists,
} from '@/hooks/useLibrary';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

/** `onRematch`: the track came from an import, so on phones (where the row
 *  has no room for a separate More button) this menu also offers "Wrong
 *  song? Re-match".
 *
 *  `more`: menu items for a caller with no room for its own buttons (the
 *  player bar on a narrow window), ending in their own separator. They go
 *  above the playlists, under an "Add to playlist" label, and the trigger
 *  becomes a "More" (...) button. */
export function AddToPlaylistMenu({
  track,
  onRematch,
  more,
  triggerClassName,
}: {
  track: Track;
  onRematch?: () => void;
  more?: ReactNode;
  triggerClassName?: string;
}) {
  const { user } = useAuth();
  const { data: playlists = [] } = useQueryPlaylists();
  const addToPlaylist = useExecuteAddToPlaylist();
  const createPlaylist = useExecuteCreatePlaylist();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  if (!user) return null;

  const add = async (id: string, playlistName: string) => {
    setOpen(false);
    try {
      await addToPlaylist.mutateAsync({ id, track });
      toast.success(`Added "${track.title}" to ${playlistName}`);
    } catch (e) {
      // Unique-index conflict means the track is already in the playlist;
      // every other failure is real.
      const status = (e as { status?: number } | undefined)?.status;
      if (status === 400) toast.message(`"${track.title}" is already in ${playlistName}`);
      else toast.error(`Couldn't add "${track.title}" — please try again.`);
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
      toast.error(`Couldn't create the playlist — please try again.`);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
          triggerClassName,
        )}
        onClick={(e) => e.stopPropagation()}
        aria-label={more ? 'More' : 'Add to playlist'}
        title={more ? 'More' : undefined}
      >
        {more ? <MoreIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56" onClick={(e) => e.stopPropagation()}>
        {more && (
          <>
            {more}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
            </DropdownMenuGroup>
          </>
        )}
        {onRematch && (
          <>
            <DropdownMenuItem
              onClick={() => {
                setOpen(false);
                onRematch();
              }}
              className="md:hidden"
            >
              <RefreshIcon className="h-3.5 w-3.5" /> Wrong song? Re-match
            </DropdownMenuItem>
            <DropdownMenuSeparator className="md:hidden" />
          </>
        )}
        <DropdownMenuItem onClick={openCreate} className="text-ember font-semibold">
          <PlusIcon className="h-3.5 w-3.5" /> New playlist
        </DropdownMenuItem>
        {playlists.length > 0 && <DropdownMenuSeparator />}
        {/* The item is a flex row, and an ellipsis never shows on a flex
            box's bare text: the name gets its own box to truncate. */}
        {playlists.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => add(p.id, p.name)} title={p.name}>
            <span className="min-w-0 truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
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
