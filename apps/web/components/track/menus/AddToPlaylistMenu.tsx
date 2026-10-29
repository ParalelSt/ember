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
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ListPlusIcon, MoreIcon, MusicIcon, PlusIcon, RefreshIcon } from '@/components/icons';
import { ActionSheet, ActionSheetItem, type MenuAction } from '@/components/ui/action-sheet';
import { Artwork } from '@/components/primitives/Artwork';
import { useIsDesktop } from '@/hooks/useIsDesktop';
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
 *  song? Re-match". `open`/`onOpenChange` let a parent open the menu from
 *  elsewhere; with `hiddenTrigger` the + button is only an invisible anchor
 *  for it (the full-screen player's More sheet opens it, just under its ⋯).
 *
 *  `more`: menu items for a caller with no room for its own buttons (the
 *  desktop player bar on a narrow window, bughunt V1), ending in their own
 *  separator. They go above the playlists, under an "Add to playlist"
 *  label, and the trigger becomes a "More" (...) button.
 *
 *  `actions`: the same idea as data (TrackMenu's Add to queue, Share), so on
 *  a phone the whole menu can be an ActionSheet (owner's popups1 pick): the
 *  song on top, big rows, and Add to playlist opening its own list. Desktop
 *  keeps the dropdown. */
export function AddToPlaylistMenu({
  track,
  onRematch,
  open: openProp,
  onOpenChange,
  hiddenTrigger,
  more,
  actions,
  triggerClassName,
  allowAdd = true,
  footer,
}: {
  track: Track;
  onRematch?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hiddenTrigger?: boolean;
  more?: ReactNode;
  actions?: MenuAction[];
  triggerClassName?: string;
  allowAdd?: boolean;
  /** One action set apart at the very end, after a divider (recent
   *  searches' Remove, /dizajn option R4). */
  footer?: MenuAction;
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
  const isDesktop = useIsDesktop();
  // On the phone sheet: the menu itself, or the list of playlists.
  const [view, setView] = useState<'main' | 'add'>('main');
  // The playlists that already have this song: marked "Added" and not
  // offered again. Asked for when the menu opens.
  const { data: containingIds } = useQueryPlaylistsContaining(track.id, open);
  const containing = new Set(containingIds ?? []);

  const hasMenu = !!more || !!actions?.length;
  if (!user && !hasMenu) return null;
  const canAdd = !!user && allowAdd;

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

  const createDialog = (
    <CreatePlaylistDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onCreate={handleCreate}
      initialTracks={[track]}
    />
  );

  // A phone gets the sheet; `more` is dropdown items (the desktop player
  // bar's), so it keeps the dropdown wherever it is.
  if (!isDesktop && !more) {
    const firstView = actions?.length || onRematch ? 'main' : 'add';
    // With nothing but playlists to show, the list is the menu (this also
    // covers a sheet opened from outside, which never passes showSheet).
    const shown = firstView === 'add' ? 'add' : view;
    const showSheet = (next: boolean) => {
      if (next) setView(firstView);
      setOpen(next);
    };
    const run = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const header = (
      <div className="flex min-w-0 items-center gap-row text-left">
        {shown === 'add' && firstView === 'main' && (
          <button
            type="button"
            onClick={() => setView('main')}
            aria-label="Back"
            className="-ml-cluster inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-accent"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
        )}
        {shown === 'add' ? (
          <div className="text-base font-semibold">Add to playlist</div>
        ) : (
          <>
            <Artwork src={track.artworkUrl} className="size-12 shrink-0 rounded-md bg-art">
              <div className="grid h-full w-full place-items-center text-foreground/30">
                <MusicIcon className="h-5 w-5" />
              </div>
            </Artwork>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{track.title}</div>
              <div className="truncate text-sm text-muted-foreground">{track.artist}</div>
            </div>
          </>
        )}
      </div>
    );
    return (
      <>
        {!hiddenTrigger && (
          <button
            type="button"
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
              triggerClassName,
            )}
            onClick={(e) => {
              e.stopPropagation();
              showSheet(true);
            }}
            aria-label={hasMenu ? 'More' : 'Add to playlist'}
            aria-haspopup="dialog"
          >
            {hasMenu ? <MoreIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
          </button>
        )}
        <ActionSheet
          open={open}
          onOpenChange={showSheet}
          title={shown === 'add' ? 'Add to playlist' : `${track.title} options`}
          header={header}
        >
          {shown === 'main' ? (
            <>
              {canAdd && (
                <ActionSheetItem
                  icon={ListPlusIcon}
                  onSelect={() => setView('add')}
                  trailing={<ChevronRightIcon className="h-4 w-4 text-muted-foreground" />}
                  testId="sheet-add-to-playlist"
                >
                  Add to playlist
                </ActionSheetItem>
              )}
              {actions?.map((a) => (
                <ActionSheetItem key={a.key} icon={a.icon} onSelect={run(a.onSelect)} tone={a.destructive ? 'destructive' : undefined}>
                  {a.label}
                </ActionSheetItem>
              ))}
              {onRematch && (
                <ActionSheetItem icon={RefreshIcon} onSelect={run(onRematch)}>
                  Wrong song? Re-match
                </ActionSheetItem>
              )}
              {footer && (
                <>
                  <div role="separator" className="mx-row my-cluster h-px bg-border" />
                  <ActionSheetItem icon={footer.icon} onSelect={run(footer.onSelect)} tone={footer.destructive ? 'destructive' : undefined}>
                    {footer.label}
                  </ActionSheetItem>
                </>
              )}
            </>
          ) : (
            <>
              <ActionSheetItem icon={PlusIcon} tone="ember" onSelect={openCreate}>
                New playlist
              </ActionSheetItem>
              {playlists.map((p) => {
                const has = containing.has(p.id);
                return (
                  <ActionSheetItem
                    key={p.id}
                    icon={ListPlusIcon}
                    onSelect={has ? undefined : () => add(p.id, p.name)}
                    disabled={has}
                    trailing={
                      has ? (
                        <span className="flex shrink-0 items-center gap-inset text-xs text-muted-foreground">
                          <CheckIcon className="h-3.5 w-3.5" aria-hidden /> Added
                        </span>
                      ) : undefined
                    }
                  >
                    {p.name}
                  </ActionSheetItem>
                );
              })}
            </>
          )}
        </ActionSheet>
        {createDialog}
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
          hiddenTrigger && 'pointer-events-none opacity-0',
          triggerClassName,
        )}
        onClick={(e) => e.stopPropagation()}
        aria-label={hasMenu ? 'More' : 'Add to playlist'}
        title={hasMenu ? 'More' : undefined}
        aria-hidden={hiddenTrigger || undefined}
        tabIndex={hiddenTrigger ? -1 : undefined}
      >
        {hasMenu ? <MoreIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56" onClick={(e) => e.stopPropagation()}>
        {hasMenu && (
          <>
            {more}
            {actions?.map((a) => (
              <DropdownMenuItem key={a.key} onClick={a.onSelect} variant={a.destructive ? 'destructive' : undefined}>
                <a.icon className="h-3.5 w-3.5" /> {a.label}
              </DropdownMenuItem>
            ))}
            {actions?.length ? <DropdownMenuSeparator /> : null}
            {user && allowAdd && <DropdownMenuGroup>
              <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
            </DropdownMenuGroup>}
          </>
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
        {onRematch && <DropdownMenuSeparator className="md:hidden" />}
        {user && allowAdd && <>
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
        </>}
        {footer && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={footer.onSelect} variant={footer.destructive ? 'destructive' : undefined}>
              <footer.icon className="h-3.5 w-3.5" /> {footer.label}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      {createDialog}
    </DropdownMenu>
  );
}
