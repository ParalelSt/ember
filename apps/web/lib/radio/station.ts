import type { Track } from '@/types/track';

/** Live internet radio (Radio Browser, https://www.radio-browser.info): the
 *  shape the app shows a station in, and the player's view of one. Shared by
 *  the server routes, the web app and (as JSON) the Android player. */

/** A station as the routes hand it out. The stream's real address stays on
 *  the server: players get `track.streamUrl`, the host's own proxy route,
 *  which takes nothing but the station id. */
export interface RadioStation {
  /** Radio Browser's stationuuid. */
  id: string;
  name: string;
  /** An https logo, or null (an http one cannot load on an https page). */
  favicon: string | null;
  country: string;
  countryCode: string;
  state: string;
  codec: string;
  /** kbps; 0 when not known. */
  bitrate: number;
  votes: number;
  /** Kilometres from the place asked about (the Nearby list only). */
  distanceKm: number | null;
  /** The station as the player plays it (see stationTrack). */
  track: Track;
}

export const STATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStationId(id: unknown): id is string {
  return typeof id === 'string' && STATION_ID_RE.test(id);
}

/** Where the player streams a station from: the host's proxy (app/api/radio/
 *  stream), same origin, so an http-only station plays on an https page and
 *  the web player's audio graph can read it. */
export function stationStreamPath(id: string): string {
  return `/api/radio/stream/${id}`;
}

/** A station's logo, fetched through the host (app/api/radio/logo), so the
 *  page may read its pixels for the tile's colour. It takes the station id
 *  only; the server fetches the logo Radio Browser listed for it. */
export function stationLogoPath(id: string): string {
  return `/api/radio/logo/${id}`;
}

/** ~0.1 degree (about 10 km): enough for "near me", too coarse to say where
 *  someone lives, and it lets everyone in a town share one cached list. The
 *  app rounds before it asks; the server rounds again whatever it is sent. */
export function roundCoord(v: number): number {
  return Math.round(v * 10) / 10;
}

/** The country whose stations stand in for Nearby when the listener has
 *  not shared where they are (the owner's). */
export const RADIO_HOME_COUNTRY = 'HR';

/** A live station rather than a song: no length, no seeking, nothing to
 *  like, add to a playlist or record as a play. */
export function isLiveTrack(track: Pick<Track, 'source'> | null | undefined): boolean {
  return track?.source === 'station';
}

/** The line under a station's name: where it is. */
export function stationSubtitle(s: { state?: string; country?: string }): string {
  return [s.state, s.country].map((v) => v?.trim()).filter(Boolean).join(', ') || 'Live radio';
}

/** The region a station is in, for a tile's short line: its state, or
 *  its country when Radio Browser names no state. */
export function stationRegion(s: { state?: string; country?: string }): string {
  return s.state?.trim() || s.country?.trim() || 'Live radio';
}

/** The player's item for a station. */
export function stationTrack(s: { id: string; name: string; favicon: string | null; state?: string; country?: string }): Track {
  return {
    id: `station:${s.id}`,
    source: 'station',
    sourceId: s.id,
    title: s.name,
    artist: stationSubtitle(s),
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 0,
    artworkUrl: s.favicon,
    streamUrl: stationStreamPath(s.id),
  };
}

/** The song a station is playing, from its stream's ICY metadata
 *  (lib/radio/nowPlaying): "Artist - Title" as most stations send it, the
 *  whole line as the title when it has no artist part. */
export interface StationSong {
  title: string;
  artist: string | null;
}

/** A station shown like a song (Discord's card): the song as the title and
 *  artist, the station's name where the album goes, its logo as the cover.
 *  The station as it is when no song is known, and any other track as it
 *  is. */
export function stationSongTrack<T extends Track | null>(track: T, song: StationSong | null): T {
  if (!track || !song || !isLiveTrack(track)) return track;
  return { ...track, title: song.title, artist: song.artist ?? track.title, album: track.title } as T;
}
