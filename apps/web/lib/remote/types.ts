import type { LoopMode } from '@/stores/usePlayerStore';
import type { BrowserFamily, DevicePlatform } from '@/lib/versions/label';
import type { PlaybackContext, Track } from '@/types/track';

/** Controlling playback on your other devices (docs/plans/
 *  2026-11-08-device-remote-control.md). Shapes shared by the server store,
 *  the routes and the client: no React, no Next, no server-only imports. */

export const SHELLS = ['web', 'android', 'tauri'] as const;
export type RemoteShell = (typeof SHELLS)[number];

/** What a playing device reports on every beat: small, about 200 bytes. */
export interface LightState {
  trackId: string | null;
  /** The playing entry's index in the device's whole queue. */
  index: number;
  /** lib/remote/snapshot queueHash: the queue's song ids, in order. */
  queueHash: string;
  position: number;
  duration: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
}

/** The whole picture, sent when the track or the queue changed (or the
 *  server asks for it after a restart). About 10 KB. */
export interface FullState extends LightState {
  track: Track | null;
  /** The next songs after the playing one, at most UP_NEXT_MAX. */
  upNext: Track[];
  queueLength: number;
  loopMode: LoopMode;
  shuffle: boolean;
  context: PlaybackContext | null;
}

/** A device's state as the server holds it. `at` and `changedAt` are the
 *  server's clock: `at` when the report arrived, `changedAt` when the play
 *  state (playing or paused, or the song) last changed. */
export interface Snapshot extends FullState {
  at: number;
  changedAt: number;
}

export interface SetQueueArgs {
  tracks: Track[];
  index: number;
  play: boolean;
  startSec: number;
  context: PlaybackContext | null;
}

/** A command as a controller sends it. Each type's arguments are bounded by
 *  lib/remote/parse. */
export type CommandBody =
  | { type: 'play' }
  | { type: 'pause'; args?: { reason?: 'took-over'; by?: string } }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; args: { sec: number } }
  | { type: 'setVolume'; args: { volume: number } }
  | { type: 'setLoop'; args: { mode: LoopMode } }
  | { type: 'setShuffle'; args: { on: boolean } }
  | { type: 'playAt'; args: { index: number } }
  | { type: 'addToQueue'; args: { tracks: Track[] } }
  | { type: 'setQueue'; args: SetQueueArgs };

export type CommandType = CommandBody['type'];

export const COMMAND_TYPES: readonly CommandType[] = [
  'play', 'pause', 'next', 'prev', 'seek', 'setVolume', 'setLoop', 'setShuffle', 'playAt', 'addToQueue', 'setQueue',
];

/** A command as the player receives it. */
export type RemoteCommand = CommandBody & {
  id: string;
  /** The device that sent it, null for the server's own (a takeover). */
  issuedBy: string | null;
  issuedAt: number;
  expiresAt: number;
};

/** POST /api/remote/beat. Exactly one of `light` and `full`. */
export interface BeatBody {
  deviceId: string;
  label: string;
  platform: DevicePlatform;
  shell: RemoteShell;
  /** A browser's family ("Firefox"), to tell two browsers apart. */
  browser?: BrowserFamily | null;
  light?: LightState;
  full?: FullState;
  /** Ids of the commands this device has run since its last beat. */
  acked: string[];
  /** This page's own id (one per tab): a device id is shared by every tab
   *  of one browser, and only one of them may be the player. */
  instance?: string;
  /** The page is going away (pagehide): nothing plays here any more, and
   *  this device takes no commands until it beats again. */
  bye?: true;
  /** Nothing to say back yet? Then the server holds the answer up to
   *  HOLD_MS and answers early when a command comes in or another device
   *  starts watching (a long poll: lib/remote/cadence). */
  hold?: boolean;
}

export interface BeatAnswer {
  now: number;
  commands: RemoteCommand[];
  /** Other devices that asked for the state within WATCH_FRESH_MS. */
  watchers: number;
  active: string | null;
  want?: 'full';
  /** Another device plays now: this one should stop (one at a time). */
  yield?: { by: string };
}

/** A device in the GET /api/remote/state answer. */
export interface RemoteDevice {
  deviceId: string;
  label: string;
  platform: DevicePlatform;
  shell: RemoteShell;
  browser?: BrowserFamily | null;
  lastBeat: number;
  /** No beat for STALE_MS: shown as "last seen", never commanded. */
  stale: boolean;
  snapshot: Snapshot | null;
}

/** A device in a light answer (the rev did not change): only what moves. */
export interface LightDevice {
  deviceId: string;
  position: number;
  isPlaying: boolean;
  at: number;
}

export interface StateAnswer {
  now: number;
  rev: number;
  active: string | null;
  /** Full devices when `light` is absent; else only what moves. */
  devices: RemoteDevice[] | LightDevice[];
  light?: true;
}

/** Server timing. */
export const STALE_MS = 35_000;
export const DROP_MS = 10 * 60_000;
export const COMMAND_TTL_MS = 20_000;
/** A paused device stays the active one this long after it paused. */
export const TAKEOVER_WINDOW_MS = 2 * 60_000;
/** A watcher counts while it asked for the state this recently. */
export const WATCH_FRESH_MS = 6_000;
/** The longest a held beat waits for news before it is answered. */
export const HOLD_MS = 15_000;

/** At most this many devices per account; a new one evicts the one heard
 *  from longest ago. */
export const MAX_DEVICES_PER_USER = 16;
/** How often the whole store is swept for idle accounts. */
export const SWEEP_MS = 60_000;

/** Payload bounds. */
export const UP_NEXT_MAX = 20;
export const SET_QUEUE_MAX = 300;
export const ADD_TO_QUEUE_MAX = 50;
export const MAX_POSITION_SEC = 86_400;
export const MAX_QUEUE_LENGTH = 100_000;
export const LABEL_MAX = 60;
export const MAX_PENDING_COMMANDS = 50;
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** lib/versions/device's id for a browser without storage: every such
 *  browser shares it, so it names no one device. */
export const NO_STORAGE_DEVICE = 'no-storage';
export const INSTANCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Songs a single-song context keeps out of radio, as relayed. */
export const EXCLUDE_MAX = 50;
export const COMMAND_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
