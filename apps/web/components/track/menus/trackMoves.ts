/** Move up / Move down for one song of a playlist shown in its own order.
 *  A missing side means the song is already at that end. */
export interface TrackMoves {
  up?: () => void;
  down?: () => void;
}
