'use client';

import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { ShareButton } from '../ShareButton';
import { isUnavailable } from '@/lib/playback/queueNav';
import type { Track } from '@/types/track';

/** The per-row menu (add to playlist + share). Both halves fetch on their
 *  own, so this lives outside `TrackList` and pages pass it in through the
 *  `trailing` slot: that keeps the list renderable with props alone.
 *
 *  A track the server has confirmed is gone loses "Add to playlist": it
 *  would only put a dead entry in another list. Share still works, since
 *  the link identifies the song rather than the upload. */
export function TrackMenu({ track }: { track: Track }) {
  return (
    <>
      {!isUnavailable(track) && <AddToPlaylistMenu track={track} />}
      <ShareButton track={track} />
    </>
  );
}

/** Ready-made `trailing` callback, so each page spells it once. */
export const renderTrackMenu = (track: Track) => <TrackMenu track={track} />;
