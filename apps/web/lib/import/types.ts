import type { Track } from '@/types/track';
import type { SourceItem } from '@/lib/import/embed';
import type { MatchStatus } from '@/lib/import/score';

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
  | { source: 'ytmusic'; name: string; tracks: Track[] }
  | {
      source: 'spotify';
      id: string;
      name: string;
      coverUrl: string | null;
      items: SourceItem[];
      /** Spotify listed its 100-track maximum, so the playlist may be longer. */
      truncated: boolean;
    };
