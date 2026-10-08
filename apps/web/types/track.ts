/**
 * Canonical Track shape used end-to-end (API, route handlers, store, UI).
 * Compound id is `{source}:{sourceId}` so the DB pool can dedupe across sources.
 */
export interface Track {
  id: string;
  /** `upload` = a song a member added from their own files (see lib/uploads). */
  source: 'jamendo' | 'youtube' | 'upload';
  sourceId: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  albumId: string | null;
  durationSec: number;
  artworkUrl: string | null;
  streamUrl: string;
  /** Set once the server has confirmed yt-dlp can't play this track anymore
   *  (removed / private / geo / etc). Absent or null means available. */
  unavailableAt?: string | null;
  unavailableReason?: string | null;
}

/** A song in a playlist or in Liked songs, with when it landed there (the
 *  playlist row's `created`, the like's `liked_at`). The list routes add it
 *  for "Date added" sorting; everything else ignores it. */
export type CollectionTrack = Track & {
  addedAt: string;
  /** Who put it in a collaborative playlist (GET /api/playlists/:id sets it
   *  only when the playlist is collaborative). Null: not known, e.g. their
   *  account was deleted. */
  addedBy?: PlaylistPerson | null;
};

/** Someone as other members see them: a name and a picture, never an email
 *  address. */
export interface PlaylistPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** `owner`: your own playlist. `member`: someone else's collaborative
 *  playlist you were added to. */
export type PlaylistRole = 'owner' | 'member';

export interface Playlist {
  id: string;
  name: string;
  created_at: string;
  artwork_url: string | null;
  /** Set on a playlist made by an import (only on GET /api/playlists/:id,
   *  and only for its owner). */
  import_job?: string | null;
  /** The owner lets members add, remove and reorder its songs. */
  collaborative?: boolean;
  /** Absent from an older server: treat as `owner`. */
  role?: PlaylistRole;
  /** The owner's name, on a playlist shared with you (`role: 'member'`). */
  owner_name?: string | null;
  /** The owner's picture, on a playlist shared with you (the "Shared by"
   *  badge). Null when they have none. */
  owner_avatar_url?: string | null;
}

export interface AlbumSummary {
  browseId: string;
  title: string;
  year: number | string | null;
  thumbnails: { url: string; width?: number; height?: number }[];
}

export interface ArtistPayload {
  name: string;
  description: string | null;
  thumbnails: { url: string; width?: number; height?: number }[];
  tracks: Track[];
  albums: AlbumSummary[];
  singles: AlbumSummary[];
}

export interface AlbumDetail {
  title: string;
  artist: string;
  artistId: string | null;
  year: number | null;
  thumbnails: { url: string; width?: number; height?: number }[];
  trackCount: number;
  totalDurationSec: number;
  tracks: Track[];
}

/** Where a queue was started from. Drives radio-mode behavior, e.g. when the
 *  artist's catalog finishes, we filter out more-of-the-same so the listener
 *  drifts into similar-genre tracks by other artists. */
export type PlaybackContext =
  | { type: 'artist'; artistName: string; artistId?: string | null }
  | { type: 'search'; query?: string }
  | { type: 'playlist'; playlistId: string; playlistName: string }
  | { type: 'album'; albumId: string; albumTitle: string }
  | { type: 'liked' }
  | { type: 'history' }
  | { type: 'uploads' }
  | { type: 'radio' }
  /** `exclude`: songs radio must not add after it (lib/trackIdentity keys),
   *  e.g. a recommendation played from under a playlist skips what the
   *  playlist already has. */
  | { type: 'single'; exclude?: string[] };

/** One row of a live carlist session queue. */
export interface SessionQueueItem {
  id: string;
  position: number;
  played: boolean;
  /** Who added it, as everyone sees them (lib/collab publicName). */
  addedByName: string;
  addedBy: PlaylistPerson | null;
  track: Track;
}

/** Poll payload for a live session (GET /api/sessions/[id]). */
export interface SessionState {
  session: {
    id: string;
    code: string;
    name: string;
    active: boolean;
    nowIndex: number;
    hostName: string;
    hostId: string;
    isHost: boolean;
    /** The signed-in viewer's id ("Added by You"). */
    viewerId: string;
    /** About how long the current song has played: time since the host last
     *  moved on (the session row's update time). null when unknown. */
    nowElapsedMs: number | null;
  };
  /** Everyone in the car, the host first. */
  members: PlaylistPerson[];
  queue: SessionQueueItem[];
}

/** GET /api/sessions: the live carlist the signed-in user hosts or joined. */
export interface LiveCarlist {
  id: string;
  code: string;
  name: string;
  isHost: boolean;
}
