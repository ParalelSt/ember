import { deviceWord, sanitizeBrowser, sanitizePlatform } from '@/lib/versions/label';
import type { LoopMode } from '@/stores/usePlayerStore';
import type { PlaybackContext, Track } from '@/types/track';
import {
  ADD_TO_QUEUE_MAX,
  COMMAND_ID_RE,
  DEVICE_ID_RE,
  LABEL_MAX,
  MAX_POSITION_SEC,
  MAX_QUEUE_LENGTH,
  SET_QUEUE_MAX,
  SHELLS,
  UP_NEXT_MAX,
  type BeatBody,
  type CommandBody,
  type FullState,
  type LightState,
  type RemoteShell,
} from './types';

/** Every body the remote routes accept, checked and bounded here. Anything
 *  that is not exactly what a client sends is refused (null), never
 *  repaired, except labels, which are cleaned and cut. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isInt = (v: unknown, min: number, max: number): v is number => isNum(v, min, max) && Number.isInteger(v);

const SOURCES: readonly Track['source'][] = ['jamendo', 'youtube', 'upload', 'station'];
const LOOP_MODES: readonly LoopMode[] = ['off', 'all', 'one'];

export function isDeviceId(v: unknown): v is string {
  return typeof v === 'string' && DEVICE_ID_RE.test(v);
}

/** A label as a person reads it: no control characters, at most LABEL_MAX
 *  characters, the platform's word when nothing is left. */
export function cleanLabel(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return (s || fallback).slice(0, LABEL_MAX);
}

const nullableStr = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null;
  return isStr(v, max) ? v : undefined;
};

/** One song, in the app's own Track shape. Null for anything else. */
export function parseTrack(v: unknown): Track | null {
  if (!isObj(v)) return null;
  if (!isStr(v.id, 200) || !v.id) return null;
  if (!SOURCES.includes(v.source as Track['source'])) return null;
  if (!isStr(v.sourceId, 200) || !v.sourceId) return null;
  if (!isStr(v.title, 500)) return null;
  if (!isStr(v.artist, 500)) return null;
  if (!isStr(v.streamUrl, 2000) || !v.streamUrl) return null;
  if (!isNum(v.durationSec, 0, MAX_POSITION_SEC)) return null;
  const artistId = nullableStr(v.artistId, 200);
  const album = nullableStr(v.album, 500);
  const albumId = nullableStr(v.albumId, 200);
  const artworkUrl = nullableStr(v.artworkUrl, 2000);
  const unavailableAt = nullableStr(v.unavailableAt, 100);
  const unavailableReason = nullableStr(v.unavailableReason, 300);
  if ([artistId, album, albumId, artworkUrl, unavailableAt, unavailableReason].includes(undefined)) return null;
  const track: Track = {
    id: v.id,
    source: v.source as Track['source'],
    sourceId: v.sourceId,
    title: v.title,
    artist: v.artist,
    artistId: artistId ?? null,
    album: album ?? null,
    albumId: albumId ?? null,
    durationSec: v.durationSec,
    artworkUrl: artworkUrl ?? null,
    streamUrl: v.streamUrl,
  };
  if (unavailableAt) track.unavailableAt = unavailableAt;
  if (unavailableReason) track.unavailableReason = unavailableReason;
  return track;
}

function parseTracks(v: unknown, max: number): Track[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: Track[] = [];
  for (const item of v) {
    const t = parseTrack(item);
    if (!t) return null;
    out.push(t);
  }
  return out;
}

const s200 = (v: unknown) => isStr(v, 200);

/** Where a queue came from (types/track PlaybackContext). Undefined when it
 *  is not one. */
export function parseContext(v: unknown): PlaybackContext | null | undefined {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return undefined;
  switch (v.type) {
    case 'artist':
      if (!s200(v.artistName)) return undefined;
      if (v.artistId !== undefined && v.artistId !== null && !s200(v.artistId)) return undefined;
      return { type: 'artist', artistName: v.artistName as string, artistId: (v.artistId as string | null | undefined) ?? null };
    case 'search':
      if (v.query !== undefined && !isStr(v.query, 300)) return undefined;
      return v.query === undefined ? { type: 'search' } : { type: 'search', query: v.query as string };
    case 'playlist':
      if (!s200(v.playlistId) || !isStr(v.playlistName, 300)) return undefined;
      return { type: 'playlist', playlistId: v.playlistId as string, playlistName: v.playlistName as string };
    case 'album':
      if (!s200(v.albumId) || !isStr(v.albumTitle, 300)) return undefined;
      return { type: 'album', albumId: v.albumId as string, albumTitle: v.albumTitle as string };
    case 'liked':
    case 'history':
    case 'uploads':
    case 'radio':
      return { type: v.type };
    case 'stations':
      if (!isStr(v.name, 200)) return undefined;
      return { type: 'stations', name: v.name as string };
    case 'single': {
      if (v.exclude === undefined) return { type: 'single' };
      if (!Array.isArray(v.exclude) || v.exclude.length > 500 || !v.exclude.every((x) => isStr(x, 300))) return undefined;
      return { type: 'single', exclude: v.exclude as string[] };
    }
    default:
      return undefined;
  }
}

export function parseLight(v: unknown): LightState | null {
  if (!isObj(v)) return null;
  const trackId = v.trackId === null ? null : isStr(v.trackId, 200) && v.trackId ? v.trackId : undefined;
  if (trackId === undefined) return null;
  if (!isInt(v.index, -1, MAX_QUEUE_LENGTH)) return null;
  if (!isStr(v.queueHash, 64)) return null;
  if (!isNum(v.position, 0, MAX_POSITION_SEC) || !isNum(v.duration, 0, MAX_POSITION_SEC)) return null;
  if (typeof v.isPlaying !== 'boolean' || typeof v.muted !== 'boolean') return null;
  if (!isNum(v.volume, 0, 1)) return null;
  return {
    trackId,
    index: v.index,
    queueHash: v.queueHash,
    position: v.position,
    duration: v.duration,
    isPlaying: v.isPlaying,
    volume: v.volume,
    muted: v.muted,
  };
}

export function parseFull(v: unknown): FullState | null {
  const light = parseLight(v);
  if (!light || !isObj(v)) return null;
  const track = v.track === null ? null : parseTrack(v.track);
  if (v.track !== null && !track) return null;
  if ((track?.id ?? null) !== light.trackId) return null;
  const upNext = parseTracks(v.upNext, UP_NEXT_MAX);
  if (!upNext) return null;
  if (!isInt(v.queueLength, 0, MAX_QUEUE_LENGTH)) return null;
  if (!LOOP_MODES.includes(v.loopMode as LoopMode)) return null;
  if (typeof v.shuffle !== 'boolean') return null;
  const context = parseContext(v.context);
  if (context === undefined) return null;
  return { ...light, track, upNext, queueLength: v.queueLength, loopMode: v.loopMode as LoopMode, shuffle: v.shuffle, context };
}

/** POST /api/remote/beat's body. */
export function parseBeat(body: unknown): BeatBody | null {
  if (!isObj(body)) return null;
  if (!isDeviceId(body.deviceId)) return null;
  const platform = sanitizePlatform(body.platform);
  if (!platform) return null;
  if (!SHELLS.includes(body.shell as RemoteShell)) return null;
  const acked = body.acked === undefined ? [] : body.acked;
  if (!Array.isArray(acked) || acked.length > 100 || !acked.every((a) => typeof a === 'string' && COMMAND_ID_RE.test(a))) return null;
  const hasLight = body.light !== undefined;
  const hasFull = body.full !== undefined;
  if (hasLight === hasFull) return null;
  const out: BeatBody = {
    deviceId: body.deviceId,
    label: cleanLabel(body.label, deviceWord(platform)),
    platform,
    shell: body.shell as RemoteShell,
    acked: acked as string[],
  };
  if (body.browser !== undefined && body.browser !== null) {
    const browser = sanitizeBrowser(body.browser);
    if (!browser) return null;
    out.browser = browser;
  }
  if (hasLight) {
    const light = parseLight(body.light);
    if (!light) return null;
    out.light = light;
  } else {
    const full = parseFull(body.full);
    if (!full) return null;
    out.full = full;
  }
  return out;
}

export type ParsedCommand =
  | { ok: true; target: string; from: string | null; command: CommandBody }
  | { ok: false; status: 400 | 413; error: string };

const bad = (error: string): ParsedCommand => ({ ok: false, status: 400, error });

/** POST /api/remote/command's body: `{ target, from?, type, args }`. */
export function parseCommand(body: unknown): ParsedCommand {
  if (!isObj(body)) return bad('Not a command');
  if (!isDeviceId(body.target)) return bad('Unknown device');
  if (body.from !== undefined && body.from !== null && !isDeviceId(body.from)) return bad('Unknown device');
  const from = (body.from as string | null | undefined) ?? null;
  const a = isObj(body.args) ? body.args : {};
  const ok = (command: CommandBody): ParsedCommand => ({ ok: true, target: body.target as string, from, command });
  switch (body.type) {
    case 'play':
    case 'next':
    case 'prev':
      return ok({ type: body.type });
    case 'pause':
      // A device may only pause another; "took over" is the server's own.
      return ok({ type: 'pause' });
    case 'seek':
      return isNum(a.sec, 0, MAX_POSITION_SEC) ? ok({ type: 'seek', args: { sec: a.sec } }) : bad('Seek out of range');
    case 'setVolume':
      return isNum(a.volume, 0, 1) ? ok({ type: 'setVolume', args: { volume: a.volume } }) : bad('Volume out of range');
    case 'setLoop':
      return LOOP_MODES.includes(a.mode as LoopMode) ? ok({ type: 'setLoop', args: { mode: a.mode as LoopMode } }) : bad('Not a loop mode');
    case 'setShuffle':
      return typeof a.on === 'boolean' ? ok({ type: 'setShuffle', args: { on: a.on } }) : bad('Not a shuffle switch');
    case 'playAt':
      return isInt(a.index, 0, MAX_QUEUE_LENGTH) ? ok({ type: 'playAt', args: { index: a.index } }) : bad('Index out of range');
    case 'addToQueue': {
      if (Array.isArray(a.tracks) && a.tracks.length > ADD_TO_QUEUE_MAX) return { ok: false, status: 413, error: 'Too many songs' };
      const tracks = parseTracks(a.tracks, ADD_TO_QUEUE_MAX);
      return tracks && tracks.length > 0 ? ok({ type: 'addToQueue', args: { tracks } }) : bad('Not a list of songs');
    }
    case 'setQueue': {
      if (Array.isArray(a.tracks) && a.tracks.length > SET_QUEUE_MAX) return { ok: false, status: 413, error: 'Too many songs' };
      const tracks = parseTracks(a.tracks, SET_QUEUE_MAX);
      if (!tracks || tracks.length === 0) return bad('Not a list of songs');
      if (!isInt(a.index, 0, tracks.length - 1)) return bad('Index out of range');
      if (typeof a.play !== 'boolean') return bad('Play or not?');
      const startSec = a.startSec === undefined ? 0 : a.startSec;
      if (!isNum(startSec, 0, MAX_POSITION_SEC)) return bad('Start out of range');
      const context = parseContext(a.context);
      if (context === undefined) return bad('Not a context');
      return ok({ type: 'setQueue', args: { tracks, index: a.index, play: a.play, startSec, context } });
    }
    default:
      return bad('Unknown command');
  }
}
