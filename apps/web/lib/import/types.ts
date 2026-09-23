import type { Track } from '@/types/track';
import type { SourceItem } from '@/lib/import/embed';
import type { MatchStatus } from '@/lib/import/score';
import type { ItemStatus, JobStatus } from '@/lib/import/jobState';

export type { SourceItem } from '@/lib/import/embed';
export type { MatchStatus } from '@/lib/import/score';

/** One YouTube Music search hit, scored against a source track. */
export interface ImportCandidate {
  track: Track;
  artists: string[];
  /** `ATV` official audio, `OMV` music video, `UGC` upload. */
  videoType: string | null;
  explicit: boolean | null;
  score: number;
  /** Short plain words for the review screen: "Length matches". */
  reasons: string[];
}

/** A source track and every candidate found for it, best first. Kept whole
 *  for accepted matches too, so any track can be re-picked later. */
export interface MatchResult {
  item: SourceItem;
  status: MatchStatus;
  /** The best candidate's score, null when nothing was found. */
  confidence: number | null;
  candidates: ImportCandidate[];
}

/** What `POST /api/import/inspect` answers. */
export type InspectResult =
  | { source: 'ytmusic'; id: string; name: string; tracks: Track[] }
  | {
      source: 'spotify';
      id: string;
      name: string;
      coverUrl: string | null;
      items: SourceItem[];
      /** Spotify listed its 100-track maximum, so the playlist may be longer. */
      truncated: boolean;
    };

/** Where the source songs came from. The first three are pasted links; the
 *  rest are transfer sources (uploads, pastes and free public APIs), and
 *  every value here is also a value of `import_jobs.source`. */
export type ImportSourceKind =
  | 'spotify'
  | 'ytmusic'
  | 'youtube'
  | 'spotify-export'
  | 'csv'
  | 'paste'
  | 'lastfm'
  | 'deezer'
  | 'apple-export';

/** Where the accepted songs land: a new playlist, or the person's likes. */
export type JobKind = 'playlist' | 'liked';

/** One background import, as the sidebar and the playlist page see it. */
export interface ImportJob {
  id: string;
  /** Who it belongs to. */
  userId: string;
  kind: JobKind;
  /** The playlist being filled, or null for a transfer into the likes. */
  playlistId: string | null;
  name: string;
  source: ImportSourceKind;
  sourceUrl: string;
  coverUrl: string | null;
  status: JobStatus;
  total: number;
  /** Source items processed so far. */
  cursor: number;
  /** Added to the playlist, or liked (accepted by the matcher, or picked by
   *  hand). */
  accepted: number;
  review: number;
  missing: number;
  /** Transfers only: accepted songs the person had already liked. */
  existing: number;
  /** Google likes transfers only: likes YouTube Music said were not music,
   *  plus uploads the person said no to in the review. */
  notMusic?: number;
  /** A sentence for the banner when paused or failed. */
  error: string | null;
  /** Paused by a backoff: when it tries again (ISO). */
  retryAt: string | null;
  dismissed: boolean;
}

/** One source track of an import and what became of it. */
export interface ImportItem {
  id: string;
  position: number;
  status: ItemStatus;
  source: SourceItem;
  /** Epoch ms this song is liked at when the job is a transfer; null for a
   *  playlist import. */
  likedAt: number | null;
  /** The YouTube video in the playlist for accepted and resolved items. */
  videoId: string | null;
  confidence: number | null;
  candidates: ImportCandidate[];
}
