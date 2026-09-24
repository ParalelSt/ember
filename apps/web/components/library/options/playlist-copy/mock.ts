import { MOCK_HOME_RECENT, MOCK_HOME_TRACKS, MOCK_LIKED_TRACKS } from '@/app/(app)/dizajn/mock';
import type { Track } from '@/types/track';
import type { CopyTrack } from '@/components/library/options/playlist-copy/model';

/** Mock data for the Playlist copy candidates: a source playlist, the
 *  Liked songs and four playlists to copy into. The overlaps are chosen to
 *  show the duplicate rule at work (model.ts `alreadyThere`):
 *
 *  - Slow Static: the same track is already liked (skipped).
 *  - Harbor Lights: Liked has "Harbor Lights (Official Video)" by
 *    "Coastline - Topic", another upload of the same song (skipped).
 *  - Звезда: Liked has the official video of the same Cyrillic song by the
 *    same artist (skipped: a non-Latin title still matches itself).
 *  - Home by Edward Sharpe: Liked has "Home" by Phillip Phillips, a
 *    different song with the same title (ADDED: the bug the same-title fix
 *    closed).
 *  - Northbound: Liked has "Northbound (Live)", a different recording
 *    (ADDED).
 *
 *  So all 15 into Liked songs gives "Added 12, skipped 3 already there". */

const ART = [
  ...MOCK_HOME_TRACKS.map((t) => t.artworkUrl),
  MOCK_HOME_RECENT[0].artworkUrl,
  ...MOCK_LIKED_TRACKS.map((t) => t.artworkUrl),
].filter((a): a is string => !!a);

function art(i: number): string {
  return ART[i % ART.length];
}

function track(id: string, title: string, artist: string, album: string | null, durationSec: number, artIndex: number | null): Track {
  return {
    id: `youtube:${id}`,
    source: 'youtube',
    sourceId: id,
    title,
    artist,
    artistId: null,
    album,
    albumId: null,
    durationSec,
    artworkUrl: artIndex === null ? null : art(artIndex),
    streamUrl: '',
  };
}

function added(t: Track, day: number): CopyTrack {
  // Spread over the summer so "Date added" sorts visibly.
  const d = new Date(Date.UTC(2026, 5, 1 + day, 20, 0, 0));
  return { ...t, addedAt: d.toISOString() };
}

const SLOW_STATIC = track('ss01', 'Slow Static', 'Aftertone', 'Low Light', 221, 7);
const HARBOR = track('hl01', 'Harbor Lights', 'Coastline', 'Tidewater', 242, 8);
const ZVEZDA = track('zv01', 'Звезда', 'Виктор Цой', 'Звезда по имени Солнце', 225, 3);
const HOME_SHARPE = track('ho01', 'Home', 'Edward Sharpe', 'Up from Below', 303, 2);
const NORTHBOUND = track('nb01', 'Northbound', 'The Nulls', 'Night Service', 263, 9);
const NIGHT_SWIM = track('ns01', 'Night Swim', 'The Nulls', 'Night Service', 214, 3);
const BLINDING = track('bl01', 'Blinding Lights', 'The Weeknd', 'After Hours', 200, 4);
const COPPER = track('cs01', 'Copper Sky', 'Coastline', 'Tidewater', 187, 1);

/** The playlist being copied from, in playlist order (date added, oldest
 *  first). */
export const MOCK_COPY_SOURCE_NAME = 'Late Night Drive';

export const MOCK_COPY_SOURCE: CopyTrack[] = [
  added(SLOW_STATIC, 0),
  added(HARBOR, 2),
  added(track('sn01', 'Second Nature', 'Field Notes', 'Margins', 198, 5), 3),
  added(NORTHBOUND, 5),
  added(HOME_SHARPE, 8),
  added(track('lt01', 'Low Tide', 'Aftertone', 'Low Light', 176, 0), 11),
  added(COPPER, 12),
  added(NIGHT_SWIM, 15),
  added(track('pp01', 'Paper Planes', 'Lowlight', 'Carbon Copies', 233, 4), 18),
  added(track('gc01', 'Glass Coast', 'Aftertone', 'Low Light', 251, 5), 21),
  added(BLINDING, 24),
  added(ZVEZDA, 27),
  added(track('md01', 'Midnight Drive', 'The Nulls', 'Night Service', 279, 6), 33),
  added(track('fd01', 'Field Day', 'Field Notes', 'Margins', 162, 2), 40),
  added(track('sw01', 'Second Wind', 'Aftertone', 'Low Light', 244, 0), 47),
];

/** Ids picked in the "Select songs one by one" step. */
export const MOCK_PICKED_IDS = [HARBOR.id, HOME_SHARPE.id, NIGHT_SWIM.id];

/** What Liked songs already holds. */
export const MOCK_COPY_LIKED: Track[] = [
  SLOW_STATIC,
  track('hl02', 'Harbor Lights (Official Video)', 'Coastline - Topic', null, 247, 8),
  track('zv02', 'Звезда (Official Video)', 'Виктор Цой', null, 228, 3),
  track('ho02', 'Home', 'Phillip Phillips', 'The World from the Side of the Moon', 210, 1),
  track('nb02', 'Northbound (Live)', 'The Nulls', 'Live at the Depot', 301, 9),
];

export type DestinationKind = 'liked' | 'playlist' | 'new';

export interface CopyDestination {
  id: string;
  kind: DestinationKind;
  name: string;
  /** What it holds now, for the duplicate check. */
  tracks: Track[];
  cover: string | null;
}

export const MOCK_LIKED_DESTINATION: CopyDestination = {
  id: 'liked',
  kind: 'liked',
  name: 'Liked songs',
  tracks: MOCK_COPY_LIKED,
  cover: null,
};

export const MOCK_NEW_PLAYLIST_NAME = `${MOCK_COPY_SOURCE_NAME} (copy)`;

/** Every playlist of the member's except the one being copied from. */
export const MOCK_COPY_PLAYLISTS: CopyDestination[] = [
  { id: 'gym', kind: 'playlist', name: 'Gym', tracks: [NIGHT_SWIM, BLINDING], cover: art(1) },
  { id: 'sunday', kind: 'playlist', name: 'Sunday Mornings', tracks: [], cover: null },
  {
    id: 'dad',
    kind: 'playlist',
    name: 'For Dad',
    // A different "Home": not a duplicate of Edward Sharpe's.
    tracks: [COPPER, track('ho02', 'Home', 'Phillip Phillips', null, 210, 1)],
    cover: art(4),
  },
  { id: 'alt', kind: 'playlist', name: '90s Alt Rock Deep Cuts', tracks: [], cover: art(0) },
];

export function newPlaylistDestination(name: string): CopyDestination {
  return { id: 'new', kind: 'new', name, tracks: [], cover: null };
}
