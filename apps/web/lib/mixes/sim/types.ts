/** The mix measurement's run file (tests/measure-mixes/README.md): what one
 *  rebuild of every member's mixes produced, with a short explanation per
 *  song. Plain data, written as JSON. */

export interface SimTrack {
  id: string;
  songKey: string;
  title: string;
  artist: string;
  artistKey: string;
  /** One of the member's own songs (played or liked), not a radio find. */
  own: boolean;
  /** The artist's stored row as the code under test reads it. */
  source: string | null;
  family: string | null;
  tags: string[];
  /** The artist has no family and no admin row. */
  untagged: boolean;
  /** The song's own family by the per-song resolver, when the code has one. */
  resolved?: string | null;
  via?: string | null;
  /** The title signal, when the code has one. */
  signal?: string | null;
  /** For an untagged artist: their home by the radio rule, when the code has one. */
  home?: string | null;
}

export interface SimMix {
  key: string;
  title: string;
  position: number;
  tracks: SimTrack[];
}

export interface SimPlan {
  key: string;
  family: string;
  sub: string | null;
  weight: number;
  songs: number;
  artists: number;
}

export interface SimMember {
  userId: string;
  eligible: boolean;
  written: string[];
  kept: string[];
  deleted: string[];
  mixes: SimMix[];
  /** The style plans the cluster made (each one qualified). */
  plans: SimPlan[];
  /** Every family the member's own songs fall in, qualified or not. */
  families: Record<string, { weight: number; songs: number; artists: number }>;
  /** Own songs no rule could place (no artist family, no title signal). */
  unrecognised: { title: string; artist: string; plays: number }[];
  /** Messages the job logged about this member (out-of-place seeds and the like). */
  notes: { message: string; detail?: Record<string, unknown> }[];
  /** Seeds whose radio was neither cached nor fetched. */
  radioMissing: string[];
}

export interface SimRun {
  label: string;
  createdAt: string;
  /** The simulated "now" (the newest play in the copy). */
  now: string;
  members: SimMember[];
}
