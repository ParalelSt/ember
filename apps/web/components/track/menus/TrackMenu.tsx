'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import type { TrackMoves } from './trackMoves';
import { ShareButton } from '../ShareButton';
import { ArrowDownIcon, ArrowUpIcon, MoreIcon, RefreshIcon } from '@/components/icons';
import { isUnavailable } from '@/lib/playback/queueNav';
import type { Track } from '@/types/track';

/** The per-row menu (add to playlist + share). Both halves fetch on their
 *  own, so this lives outside `TrackList` and pages pass it in through the
 *  `trailing` slot: that keeps the list renderable with props alone.
 *
 *  A track the server has confirmed is gone loses "Add to playlist": it
 *  would only put a dead entry in another list. Share still works, since
 *  the link identifies the song rather than the upload.
 *
 *  `onRematch` is set on a playlist track that came from an import: a
 *  "More" menu offers "Wrong song? Re-match", which reopens that song's
 *  candidates (on phones, where the row is narrow, the item sits in the
 *  add-to-playlist menu instead).
 *
 *  `moves` is set on a playlist shown in its own order: "Move up" and "Move
 *  down" in the same More menu, and on phones in the add-to-playlist menu
 *  like the re-match (an end the song cannot move past leaves its item
 *  out). */
export type { TrackMoves };

export function TrackMenu({ track, onRematch, moves }: { track: Track; onRematch?: () => void; moves?: TrackMoves }) {
  const canMove = !!(moves?.up || moves?.down);
  return (
    <>
      {!isUnavailable(track) && <AddToPlaylistMenu track={track} onRematch={onRematch} moves={moves} />}
      <ShareButton track={track} />
      {(onRematch || canMove) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:hidden"
            onClick={(e) => e.stopPropagation()}
            aria-label="More"
          >
            <MoreIcon className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56" onClick={(e) => e.stopPropagation()}>
            {moves?.up && (
              <DropdownMenuItem onClick={moves.up}>
                <ArrowUpIcon className="h-3.5 w-3.5" /> Move up
              </DropdownMenuItem>
            )}
            {moves?.down && (
              <DropdownMenuItem onClick={moves.down}>
                <ArrowDownIcon className="h-3.5 w-3.5" /> Move down
              </DropdownMenuItem>
            )}
            {onRematch && (
              <DropdownMenuItem onClick={onRematch}>
                <RefreshIcon className="h-3.5 w-3.5" /> Wrong song? Re-match
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

/** Ready-made `trailing` callback, so each page spells it once. */
export const renderTrackMenu = (track: Track) => <TrackMenu track={track} />;
