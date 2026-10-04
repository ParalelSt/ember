/** Adding a song a playlist already has: what the server answers and how
 *  the app tells it apart from a real failure. Shared by the add route
 *  (app/api/playlists/[id]/tracks) and every place that adds a song. */

/** POST /api/playlists/:id/tracks answers 409 with this when the song is
 *  already there. */
export const ALREADY_IN_PLAYLIST = 'already in this playlist';

const statusOf = (e: unknown) => (e as { status?: number } | null | undefined)?.status;

/** PocketBase's answer to a unique-index hit on playlist_tracks: a 400
 *  whose field errors say `validation_not_unique` ("Value must be
 *  unique.") on the playlist or the track. The SDK error keeps the body in
 *  `.response` (`.data` is the same object), the field errors one level
 *  further down, in its `data`. */
export function isUniqueViolation(e: unknown): boolean {
  if (statusOf(e) !== 400) return false;
  const err = e as { response?: { data?: unknown }; data?: { data?: unknown } };
  const fields = (err.response?.data ?? err.data?.data ?? {}) as Record<string, { code?: string; message?: string } | undefined>;
  return ['playlist', 'track'].some((f) => {
    const info = fields?.[f];
    return info?.code === 'validation_not_unique' || /must be unique/i.test(info?.message ?? '');
  });
}

/** An add the app should report as "Already in <playlist>", not as a
 *  failure: the 409, or the raw unique-index 400 an older server still
 *  sends ("... track: Value must be unique."). */
export function isAlreadyInPlaylist(e: unknown): boolean {
  const status = statusOf(e);
  if (status === 409) return true;
  if (status !== 400) return false;
  const message = (e as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && /must be unique/i.test(message);
}
