'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { ShareButton } from '../ShareButton';
import { ArtistIcon, MusicIcon, QueueIcon, RefreshIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { addToQueue } from '@/lib/playback/addToQueue';
import { isUnavailable } from '@/lib/playback/queueNav';
import { artistPageHref, songPageHref } from '@/lib/songPage';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { Track } from '@/types/track';

/** The per-row menu (More: add to queue and add to playlist, plus share).
 *  Both halves fetch on their own, so this lives outside `TrackList` and
 *  pages pass it in through the `trailing` slot: that keeps the list
 *  renderable with props alone.
 *
 *  A track the server has confirmed is gone loses the menu: it would only
 *  queue a song that can't play, or put a dead entry in another list. Share
 *  still works, since the link identifies the song rather than the upload,
 *  except on a phone: there the row's room goes to the title and its
 *  UNAVAILABLE pill (with every button, a phone row had about 60px left for
 *  both, and the pill read "UNAVA..."). Share is still there on a wider
 *  window.
 *
 *  `onRematch` is set on a playlist track that came from an import: the
 *  menu also offers "Wrong song? Re-match", which reopens that song's
 *  candidates.
 *
 *  "Go to song" opens the song's own page (YouTube songs; an upload has
 *  none) and "Go to artist" the artist's, when its id is known. They are
 *  links, so a desktop middle click opens them in a new tab.
 *
 *  Reordering a playlist is the list toolbar's Edit order, not a row menu. */
export function TrackMenu({ track, onRematch }: { track: Track; onRematch?: () => void }) {
  const { playTrack } = usePlayer();

  const queue = () => {
    const next = addToQueue(usePlayerStore.getState(), track);
    // Nothing loaded: there is no queue to add to, so the song just plays.
    if (!next) return playTrack(track, [track]);
    usePlayerStore.setState(next);
    toast.success(`Added "${track.title}" to the queue`);
  };

  const songHref = songPageHref(track);
  const artistHref = artistPageHref(track);

  return (
    <>
      {!isUnavailable(track) && (
        <AddToPlaylistMenu
          track={track}
          more={
            <>
              <DropdownMenuItem onClick={queue}>
                <QueueIcon className="h-3.5 w-3.5" /> Add to queue
              </DropdownMenuItem>
              {songHref && (
                <DropdownMenuItem render={<Link href={songHref} />}>
                  <MusicIcon className="h-3.5 w-3.5" /> Go to song
                </DropdownMenuItem>
              )}
              {artistHref && (
                <DropdownMenuItem render={<Link href={artistHref} />}>
                  <ArtistIcon className="h-3.5 w-3.5" /> Go to artist
                </DropdownMenuItem>
              )}
              {onRematch && (
                <DropdownMenuItem onClick={onRematch}>
                  <RefreshIcon className="h-3.5 w-3.5" /> Wrong song? Re-match
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          }
        />
      )}
      <ShareButton track={track} className={isUnavailable(track) ? 'max-md:hidden' : undefined} />
    </>
  );
}

/** Ready-made `trailing` callback, so each page spells it once. */
export const renderTrackMenu = (track: Track) => <TrackMenu track={track} />;
