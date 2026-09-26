/** The recording behind a compound track id, for the Python jobs that
 *  listen to it (lib/tabAlign.ts). */

const SOURCE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface TrackKey {
  source: 'youtube' | 'upload';
  sourceId: string;
  /** Filename-safe stem: `<source>-<sourceId>`. */
  key: string;
}

/** `youtube:<videoId>` or `upload:<pbId>`: the app's compound Track id.
 *  Anything else is refused, which also rules out traversal: the key only
 *  ever contains [A-Za-z0-9_-] and one dash. */
export function parseTrackKey(trackId: string): TrackKey | null {
  const i = trackId.indexOf(':');
  if (i <= 0) return null;
  const source = trackId.slice(0, i);
  const sourceId = trackId.slice(i + 1);
  if (source !== 'youtube' && source !== 'upload') return null;
  if (!SOURCE_ID_RE.test(sourceId)) return null;
  return { source, sourceId, key: `${source}-${sourceId}` };
}
