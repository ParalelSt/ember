'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { addToQueue } from '@/lib/playback/addToQueue';
import { claimSingleton, createBackoff, releaseSingleton, retryAfterOf } from '@/lib/pranks/backoff';
import { BURST_MAX, BURST_WINDOW_MS, CHANGE_DEBOUNCE_MS, nextBeatDelay } from '@/lib/remote/cadence';
import { buildSnapshot, lightOf } from '@/lib/remote/snapshot';
import type { BeatAnswer, BeatBody, RemoteCommand, RemoteShell } from '@/lib/remote/types';
import type { DevicePlatform } from '@/lib/versions/label';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { PlaybackContext, Track } from '@/types/track';

/** What a command from another device can make this player do: the
 *  provider's own controls, so a remote press behaves as a local one. */
export interface RemoteLinkActions {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  /** An entry of the whole queue (the controller's queue sheet). */
  playAt: (index: number) => void;
  playTrack: (track: Track, list: Track[], context: PlaybackContext | null, opts?: { autoplay?: boolean }) => void;
  /** Where the next load starts (usePositionPersistence). */
  requestStartAt: (sec: number) => void;
}

export interface RemoteIdentity {
  deviceId: string;
  label: string;
  platform: DevicePlatform;
  shell: RemoteShell;
}

/** Ids already run, so a command delivered twice runs once. */
const SEEN_MAX = 200;
/** A seek: the playhead moved further than playing could take it. */
const SEEK_JUMP_SEC = 3;
/** Two "paused because another device plays" toasts this close are one. */
const TOAST_GAP_MS = 5_000;

const playStateKey = (s: ReturnType<typeof usePlayerStore.getState>) =>
  `${s.queue[s.index]?.id ?? ''}|${s.index}|${s.isPlaying}|${s.loopMode}|${s.shuffle}|${s.volume}|${s.muted}`;

/** The playing device's side of "control playback on your other devices":
 *  a heartbeat to the server with what plays here (lib/remote/cadence: 1.5 s
 *  while another device watches, 10 s while nobody does, 30 s paused, and at
 *  once on a change), which brings back the commands other devices sent, run
 *  through the provider's controls and acknowledged on the next beat.
 *
 *  Beats go on while the page is hidden: the player may be a minimized
 *  desktop window. One link per page (claimSingleton). */
export function useRemoteLink({
  enabled,
  identity,
  actionsRef,
  beat = (body: BeatBody) => api.remote.beat(body),
  notify = (message: string) => toast(message),
}: {
  enabled: boolean;
  identity: RemoteIdentity | null;
  actionsRef: RefObject<RemoteLinkActions | null>;
  beat?: (body: BeatBody) => Promise<BeatAnswer>;
  notify?: (message: string) => void;
}) {
  const beatRef = useRef(beat);
  const notifyRef = useRef(notify);
  useEffect(() => {
    beatRef.current = beat;
    notifyRef.current = notify;
  }, [beat, notify]);

  useEffect(() => {
    if (!enabled || !identity) return;
    const owner = Symbol('remote-link');
    if (!claimSingleton('remote-link', owner)) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let again = false;
    let watchers = 0;
    let wantFull = true;
    let lastFullKey = '';
    let acked: string[] = [];
    const seen = new Set<string>();
    const burst: number[] = [];
    const backoff = createBackoff();
    let pausedSince = Date.now();
    let lastToast = 0;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (disposed) return;
      const now = Date.now();
      if (backoff.blocked(now)) {
        timer = setTimeout(send, backoff.remaining(now));
        return;
      }
      const st = usePlayerStore.getState();
      const delay = nextBeatDelay({
        hasTrack: !!st.queue[st.index],
        isPlaying: st.isPlaying,
        watchers,
        pausedForMs: st.isPlaying ? 0 : now - pausedSince,
      });
      // Owed acknowledgements go out even when nothing else would.
      const wait = delay ?? (acked.length ? 1_000 : null);
      if (wait !== null) timer = setTimeout(send, wait);
    };

    const tookOver = (by: string) => {
      const now = Date.now();
      if (now - lastToast < TOAST_GAP_MS) return;
      lastToast = now;
      notifyRef.current(`Paused: playing on ${by}`);
    };

    const run = (cmd: RemoteCommand) => {
      const a = actionsRef.current;
      if (!a) return;
      const st = usePlayerStore.getState();
      switch (cmd.type) {
        case 'play': a.play(); return;
        case 'pause':
          a.pause();
          if (cmd.args?.reason === 'took-over') tookOver(cmd.args.by ?? 'another device');
          return;
        case 'next': a.next(); return;
        case 'prev': a.prev(); return;
        case 'seek': a.seek(cmd.args.sec); return;
        case 'setVolume': st.setVolume(cmd.args.volume); return;
        case 'setLoop': st.setLoopMode(cmd.args.mode); return;
        case 'setShuffle':
          if (st.shuffle !== cmd.args.on) st.toggleShuffle();
          return;
        case 'playAt':
          if (cmd.args.index < st.queue.length) a.playAt(cmd.args.index);
          return;
        case 'addToQueue':
          for (const track of cmd.args.tracks) {
            const next = addToQueue(usePlayerStore.getState(), track);
            if (next) usePlayerStore.setState(next);
            else a.playTrack(track, [track], null);
          }
          return;
        case 'setQueue': {
          const { tracks, index, play, startSec, context } = cmd.args;
          const track = tracks[index];
          if (!track) return;
          a.requestStartAt(startSec);
          a.playTrack(track, tracks, context, { autoplay: play });
          return;
        }
      }
    };

    async function send() {
      clearTimer();
      if (disposed) return;
      if (inFlight) {
        again = true;
        return;
      }
      const now = Date.now();
      if (backoff.blocked(now)) {
        schedule();
        return;
      }
      const st = usePlayerStore.getState();
      const full = buildSnapshot(st);
      // Nothing loaded and nothing owed: a player with no song is no player.
      if (!full.track && !acked.length) return;
      const key = `${full.trackId}|${full.queueHash}|${full.loopMode}|${full.shuffle}|${JSON.stringify(full.context)}|${full.upNext.length}`;
      const sendFull = wantFull || key !== lastFullKey;
      const sending = acked;
      acked = [];
      const body: BeatBody = {
        ...identity!,
        acked: sending,
        ...(sendFull ? { full } : { light: lightOf(full) }),
      };
      inFlight = true;
      try {
        const answer = await beatRef.current(body);
        if (disposed) return;
        backoff.ok();
        if (sendFull) lastFullKey = key;
        watchers = answer.watchers;
        wantFull = answer.want === 'full';
        let ran = false;
        for (const cmd of answer.commands) {
          if (seen.has(cmd.id)) {
            // Delivered again before the ack landed: acknowledge again.
            if (!acked.includes(cmd.id)) acked.push(cmd.id);
            continue;
          }
          seen.add(cmd.id);
          if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value as string);
          acked.push(cmd.id);
          ran = true;
          try {
            run(cmd);
          } catch {
            // One bad command must not stop the link.
          }
        }
        if (answer.yield && usePlayerStore.getState().isPlaying) {
          actionsRef.current?.pause();
          tookOver(answer.yield.by);
        }
        if (ran || wantFull) again = true;
      } catch (e) {
        if (disposed) return;
        acked = [...sending, ...acked];
        backoff.fail(retryAfterOf(e));
      } finally {
        inFlight = false;
      }
      if (again) {
        again = false;
        change(true);
      }
      schedule();
    }

    /** A change worth telling at once: debounced, and capped per window
     *  so a state that flaps cannot become a flood. */
    function change(force = false) {
      if (disposed) return;
      const now = Date.now();
      if (!force) {
        while (burst.length && now - burst[0] >= BURST_WINDOW_MS) burst.shift();
        if (burst.length >= BURST_MAX) return;
        burst.push(now);
      }
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void send();
      }, CHANGE_DEBOUNCE_MS);
    }

    let lastKey = playStateKey(usePlayerStore.getState());
    let lastQueue = usePlayerStore.getState().queue;
    let lastPos = { pos: usePlayerStore.getState().position, at: Date.now(), playing: usePlayerStore.getState().isPlaying };
    const unsubscribe = usePlayerStore.subscribe((s) => {
      const now = Date.now();
      if (!s.isPlaying && lastPos.playing) pausedSince = now;
      const key = playStateKey(s);
      const expected = lastPos.pos + (lastPos.playing ? (now - lastPos.at) / 1000 : 0);
      const seeked = s.position !== lastPos.pos && Math.abs(s.position - expected) > SEEK_JUMP_SEC;
      lastPos = { pos: s.position, at: now, playing: s.isPlaying };
      if (key !== lastKey || s.queue !== lastQueue || seeked) {
        lastKey = key;
        lastQueue = s.queue;
        change();
      }
    });

    void send();
    return () => {
      disposed = true;
      unsubscribe();
      clearTimer();
      if (debounce) clearTimeout(debounce);
      releaseSingleton('remote-link', owner);
    };
  }, [enabled, identity, actionsRef]);
}
