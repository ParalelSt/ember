/** `YourLibrary.json` from Spotify's Account > Privacy > "Download your
 *  data".
 *
 *  The honest path: official, free, and the only one that does not depend on
 *  a third-party tool holding a Spotify app registration. The file has
 *  `tracks: [{ artist, album, track, uri }]` and no timestamps, so every
 *  song's like date is synthesised at job creation. Its other keys (albums,
 *  shows, episodes, artists, banned) are none of Ember's business and are
 *  ignored. Pure. */

import { field, type ParseError, type ParsedSource, type TransferItem } from '@/lib/import/sources/types';

const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;

interface RawTrack {
  artist?: unknown;
  album?: unknown;
  track?: unknown;
  uri?: unknown;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** `json` is already parsed: the caller checks the byte cap before it lets
 *  JSON.parse near the file. */
export function parseSpotifyExport(json: unknown): ParsedSource | ParseError {
  const raw = (json as { tracks?: unknown } | null)?.tracks;
  if (!Array.isArray(raw)) {
    return { error: 'That does not look like YourLibrary.json. Upload the file from Spotify with a "tracks" list in it.' };
  }

  const items: TransferItem[] = [];
  let dropped = 0;
  for (const row of raw as RawTrack[]) {
    const title = field(text(row?.track));
    if (!title) {
      dropped++;
      continue;
    }
    const artist = field(text(row?.artist));
    const uri = text(row?.uri).trim();
    items.push({
      position: items.length,
      title,
      artists: artist ? [artist] : [],
      artist,
      durationMs: null,
      explicit: null,
      uri: TRACK_URI.test(uri) ? uri : null,
      likedAt: null,
    });
  }

  if (!items.length) return { error: 'There are no liked songs in that file.' };

  return {
    kind: 'spotify-export',
    label: 'Liked songs from Spotify',
    // Spotify's export says nothing about order, and its own list reads
    // newest first.
    order: 'unknown',
    items,
    dropped,
    truncated: false,
  };
}
