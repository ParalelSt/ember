import type { Track } from '@/types/track';

/** Shared shapes for admin pranks (docs/superpowers/plans/2026-09-23-admin-pranks.md).
 *  `ping` is a no-op: it proves a person's app is reachable. */
export type PrankKind = 'swap' | 'sound' | 'ping';

export type PrankStatus = 'pending' | 'delivered' | 'skipped' | 'done' | 'expired' | 'cancelled';

/** The playback engine a target reports (PlayerProvider's backend kinds). */
export type PrankEngine = 'web' | 'capacitor' | 'android' | 'tauri-native' | 'native-stub';

export interface PrankParams {
  /** swap: 5..300 s. sound: ignored (the file's own length). */
  durationSec: number;
  /** 0.1..1, relative to the target's own volume. */
  volume: number;
  /** sound only: `duck` plays the music at 30% under it. */
  mode: 'over' | 'duck';
  /** swap only: where the prank file starts. */
  startFrom: 'start' | 'same';
  /** Set by the server, never by the client. */
  streamUrl?: string;
  catalogTrackId?: string;
}

/** What a target's app receives: one pending prank. */
export interface PrankRow {
  id: string;
  kind: PrankKind;
  params: PrankParams;
  /** Relative URL the receiver loads (always server-set), null for a ping. */
  streamUrl: string | null;
  expiresAt: string;
}

/** What the receiver hands the player layer. */
export type PrankAction =
  | { type: 'skip'; reason: string }
  | { type: 'sound'; url: string; volume: number; duck: boolean }
  | { type: 'swap'; url: string; startAt: number; durationSec: number }
  | { type: 'ack-only' }
  /** Past its expiry: a prank that arrives late is not a prank, so nothing
   *  happens and nothing is acknowledged. */
  | { type: 'ignore' };

/** The body of PATCH /api/pranks/[id]. */
export interface PrankAck {
  status: 'delivered' | 'skipped' | 'done';
  reason?: string;
  engine?: string;
  appVersion?: string;
  playedSec?: number;
}

/** A target's heartbeat, POST /api/pranks/presence. */
export interface PresenceReport {
  track: Pick<Track, 'id' | 'title' | 'artist' | 'durationSec'> | null;
  position: number;
  isPlaying: boolean;
  engine: string;
  appVersion: string;
}

/** One line of the admin log, already in words where it matters. */
export interface PrankLogEntry {
  id: string;
  kind: PrankKind;
  status: PrankStatus;
  reason: string;
  engine: string;
  targetId: string;
  targetName: string;
  issuerName: string;
  created: string;
  deliveredAt: string | null;
  doneAt: string | null;
  playedSec: number | null;
  /** Sent by a repeat rather than by hand. */
  fromRepeat: boolean;
  /** The whole line, e.g. "Aron pinged Marko at 21:03: delivered on desktop". */
  line: string;
}

/** One person on the admin page: who they are and what they play, in words. */
export interface PrankPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  /** "Playing X by Y, 1:23 of 3:45, on Android", "Paused on X", ... */
  line: string;
  /** Green dot: a fresh heartbeat that says music is playing. */
  listening: boolean;
  /** Pranks they have had this hour, as the hourly cap counts them. */
  hourCount: number;
}

/** A library entry: a short `sound` played over the music, or a `song`
 *  a swap plays instead of it. */
export type PrankSoundKind = 'sound' | 'song';

/** One library file as the admin page sees it. */
export interface PrankSound {
  id: string;
  kind: PrankSoundKind;
  name: string;
  durationSec: number;
  sizeBytes: number;
  mime: string;
  created: string;
  /** Admin preview and what a prank row's streamUrl points at. */
  url: string;
}

/** One active repeat as the admin page sees it. Times are left to the page
 *  so they read in the admin's own timezone. */
export interface PrankSchedule {
  id: string;
  targetId: string;
  targetName: string;
  soundName: string;
  intervalSec: number;
  mode: 'over' | 'duck';
  endsAt: string;
  nextFireAt: string;
  fired: number;
  /** "“Duck quack” for Marko, every 2 min". */
  line: string;
}
