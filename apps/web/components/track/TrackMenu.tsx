'use client';

import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { ShareButton } from './ShareButton';
import type { Track } from '@/types/track';

/** The per-row menu (add to playlist + share). Both halves fetch on their
 *  own, so this lives outside `TrackList` and pages pass it in through the
 *  `trailing` slot — that keeps the list renderable with props alone. */
export function TrackMenu({ track }: { track: Track }) {
  return (
    <>
      <AddToPlaylistMenu track={track} />
      <ShareButton track={track} />
    </>
  );
}

/** Ready-made `trailing` callback, so each page spells it once. */
export const renderTrackMenu = (track: Track) => <TrackMenu track={track} />;
