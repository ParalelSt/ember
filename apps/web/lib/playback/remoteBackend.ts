'use client';

import { REVERT_AFTER_MS } from '@/lib/remote/cadence';
import { extrapolate } from '@/lib/remote/extrapolate';
import { queueForTransfer } from '@/lib/remote/handover';
import type { CommandBody, Snapshot } from '@/lib/remote/types';
import type { LoopMode } from '@/stores/usePlayerStore';
import type { AudioBackend, AudioBackendEvents } from './types';

/** The other device, as the remote backend reaches it. The provider builds
 *  it from stores/useRemoteStore and api.remote; tests pass a fake. */
export interface RemoteLink {
  /** "Windows": for the messages. */
  label(): string;
  /** The controlled device's latest snapshot. */
  snapshot(): Snapshot | null;
  /** The server's clock minus this device's. */
  offset(): number;
  /** Called whenever a new state arrived (each poll). */
  subscribe(cb: () => void): () => void;
  send(command: CommandBody): Promise<unknown>;
  notify(message: string): void;
  now?(): number;
}

export interface RemoteBackend extends AudioBackend {
  readonly remote: true;
  /** Take on the device's state as it is (attaching). */
  adopt(): void;
  /** A tap on entry `index` of the mirrored queue (the queue sheet). */
  playAt(index: number): void;
  /** The latest snapshot of the controlled device. */
  snapshot(): Snapshot | null;
}

export function isRemoteBackend(b: AudioBackend | null | undefined): b is RemoteBackend {
  return !!b && (b as Partial<RemoteBackend>).remote === true;
}

/** How far the remote's playhead may be from where this page put it and
 *  still agree (a seek). */
const SEEK_AGREES_SEC = 3;
const TICK_MS = 500;

const mirrorKey = (s: Snapshot) =>
  s.track ? `${s.track.id}|${s.index}|${s.queueHash}|${s.upNext.map((t) => t.id).join(',')}` : '';

/** Plays on another device of the same account (docs/plans/
 *  2026-11-08-device-remote-control.md). A queue-owning engine, like the
 *  Android one: every control turns into a command for the device that
 *  plays, applied here at once and taken back after REVERT_AFTER_MS if the
 *  device's snapshots still say otherwise. The snapshots drive the
 *  provider: the song and what is up next (a mirror of 20), the playhead
 *  (run on between polls by the server clock), playing or paused, loop and
 *  shuffle. */
export function createRemoteBackend(events: AudioBackendEvents, link: RemoteLink): RemoteBackend {
  const now = () => link.now?.() ?? Date.now();
  let destroyed = false;
  let snap: Snapshot | null = null;
  let key = '';
  let duration = 0;
  let lastLoop: LoopMode | null = null;
  let lastShuffle: boolean | null = null;
  let level: number | null = null;
  /** The local model of the remote playhead. */
  let base = { pos: 0, at: now(), playing: false };
  const expect: {
    playing?: { value: boolean; at: number };
    seek?: { sec: number; at: number };
    skip?: { key: string; at: number };
  } = {};

  const current = () => {
    const pos = base.pos + (base.playing ? Math.max(0, (now() - base.at) / 1000) : 0);
    return duration > 0 ? Math.min(pos, duration) : pos;
  };

  const emitPlaying = (playing: boolean) => {
    if (playing) events.onPlay();
    else events.onPause();
  };

  const apply = (next: Snapshot | null, force = false) => {
    if (destroyed || !next) return;
    snap = next;
    const t = now();
    let reverted = false;

    const k = mirrorKey(next);
    if (next.track && k !== key) {
      key = k;
      events.onQueueReplaced?.([next.track, ...next.upNext], 0, { shuffle: next.shuffle, context: next.context });
      events.onQueueIndex?.(0);
    }
    if (expect.skip) {
      if (key !== expect.skip.key) delete expect.skip;
      else if (t - expect.skip.at >= REVERT_AFTER_MS) {
        delete expect.skip;
        reverted = true;
      }
    }

    const d = next.duration || next.track?.durationSec || 0;
    if (d > 0 && d !== duration) {
      duration = d;
      events.onDuration(d);
    }
    if (next.loopMode !== lastLoop) {
      lastLoop = next.loopMode;
      events.onLoopMode?.(next.loopMode);
    }
    if (next.shuffle !== lastShuffle) {
      lastShuffle = next.shuffle;
      events.onShuffle?.(next.shuffle, { initial: true });
    }

    let holdPlaying = false;
    if (expect.playing && !force) {
      if (next.isPlaying === expect.playing.value) delete expect.playing;
      else if (t - expect.playing.at >= REVERT_AFTER_MS) {
        delete expect.playing;
        reverted = true;
      } else holdPlaying = true;
    }
    const remotePos = extrapolate(next, t, link.offset());
    let holdPos = false;
    if (expect.seek && !force) {
      if (Math.abs(remotePos - current()) < SEEK_AGREES_SEC) delete expect.seek;
      else if (t - expect.seek.at >= REVERT_AFTER_MS) {
        delete expect.seek;
        reverted = true;
      } else holdPos = true;
    }
    if (force) {
      delete expect.playing;
      delete expect.seek;
      delete expect.skip;
    }
    const playing = holdPlaying ? base.playing : next.isPlaying;
    base = { pos: holdPos ? current() : remotePos, at: t, playing };
    if (!holdPlaying) emitPlaying(next.isPlaying);
    events.onTime(current());
    if (reverted) link.notify(`${link.label()} did not respond`);
  };

  const post = (command: CommandBody) => {
    void link.send(command).catch((e: unknown) => {
      if (destroyed) return;
      const status = (e as { status?: number } | null)?.status;
      link.notify(status === 409 ? `${link.label()} is not reachable` : status === 429 ? 'Slow down, try again in a moment' : `Could not reach ${link.label()}`);
      // Back to what the device last said.
      apply(snap, true);
    });
  };

  const unsubscribe = link.subscribe(() => apply(link.snapshot()));
  const tick = setInterval(() => {
    if (!destroyed && base.playing) events.onTime(current());
  }, TICK_MS);

  const skip = (command: CommandBody) => {
    expect.skip = { key, at: now() };
    post(command);
  };

  const backend: RemoteBackend = {
    remote: true,
    adopt() {
      key = '';
      apply(link.snapshot(), true);
    },
    snapshot: () => snap,
    // A remote device loads its own songs: the provider hands it the queue.
    load() {},
    play() {
      base = { pos: current(), at: now(), playing: true };
      expect.playing = { value: true, at: now() };
      events.onPlay();
      post({ type: 'play' });
    },
    pause() {
      base = { pos: current(), at: now(), playing: false };
      expect.playing = { value: false, at: now() };
      events.onPause();
      post({ type: 'pause' });
    },
    // Leaving remote mode leaves the other device playing: only an explicit
    // move pauses it (the provider sends that).
    stop() {},
    seek(sec) {
      const s = Math.max(0, sec);
      base = { pos: s, at: now(), playing: base.playing };
      expect.seek = { sec: s, at: now() };
      events.onTime(s);
      post({ type: 'seek', args: { sec: s } });
    },
    // Only a change of the listener's level is passed on, never the first
    // one: attaching must not reset the other device's volume.
    setVolume(v) {
      const next = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
      const first = level === null;
      if (next === level) return;
      level = next;
      if (!first) post({ type: 'setVolume', args: { volume: next } });
    },
    setMetadata() {},
    setRemoteCommands() {},
    getCurrentTime: () => current(),
    getDuration: () => duration,
    isPaused: () => !base.playing,
    getBufferedToEnd: () => null,
    isTransitioning: () => !!(expect.playing || expect.seek || expect.skip),
    setQueue(tracks, index, play, origin, startSec) {
      const cut = queueForTransfer(tracks, index);
      if (!cut.tracks.length) return;
      skip({ type: 'setQueue', args: { tracks: cut.tracks, index: 0, play, startSec: Math.max(0, startSec ?? 0), context: origin?.context ?? null } });
    },
    next() {
      skip({ type: 'next' });
    },
    prev() {
      skip({ type: 'prev' });
    },
    playAt(i) {
      if (!snap?.track || i < 0) return;
      skip({ type: 'playAt', args: { index: snap.index + i } });
    },
    back(i) {
      backend.playAt(i);
    },
    // A mode the snapshot brought is the device's own: not sent back. Nor
    // is this page's own mode before the device has said what it has.
    setLoop(mode) {
      if (!snap || mode === lastLoop) return;
      lastLoop = mode;
      post({ type: 'setLoop', args: { mode } });
    },
    setShuffle(on) {
      if (!snap || on === lastShuffle) return;
      lastShuffle = on;
      post({ type: 'setShuffle', args: { on } });
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      clearInterval(tick);
    },
  };
  return backend;
}
