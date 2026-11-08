'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { api, apiUrl } from '@/lib/api';
import { addToQueue } from '@/lib/playback/addToQueue';
import { claimSingleton, createBackoff, releaseSingleton, retryAfterOf } from '@/lib/pranks/backoff';
import { BEAT_WATCHED_MS, BURST_MAX, BURST_WINDOW_MS, CHANGE_DEBOUNCE_MS, HELD_TOO_SOON_MS, nextBeat } from '@/lib/remote/cadence';
import { buildSnapshot, lightOf } from '@/lib/remote/snapshot';
import type { BeatAnswer, BeatBody, RemoteCommand, RemoteShell } from '@/lib/remote/types';
import type { BrowserFamily, DevicePlatform } from '@/lib/versions/label';
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
  browser?: BrowserFamily | null;
}

/** This page's own id: every tab of a browser shares the device id, and
 *  the server takes beats from one of them only (BeatBody.instance). */
export const TAB_INSTANCE = (() => {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return `tab-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return `tab-${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;
  }
})();

/** The Web Lock one tab of the browser holds while it is the player. */
export const LINK_LOCK = 'ember-remote-link';

type Locks = Pick<LockManager, 'request'>;

const defaultLocks = (): Locks | null =>
  typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null;

const defaultBeacon = (url: string, body: Blob): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon(url, body) : false;

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
 *  while another device watches, a held beat (long poll) while nobody does
 *  or while paused, and at once on a change), which brings back the
 *  commands other devices sent, run through the provider's controls and
 *  acknowledged on the next beat.
 *
 *  Beats go on while the page is hidden: the player may be a minimized
 *  desktop window. One link per page (claimSingleton). */
export function useRemoteLink({
  enabled,
  identity,
  actionsRef,
  beat = (body: BeatBody, signal?: AbortSignal) => api.remote.beat(body, signal),
  notify = (message: string) => toast(message),
  locks = defaultLocks(),
  beacon = defaultBeacon,
}: {
  enabled: boolean;
  identity: RemoteIdentity | null;
  actionsRef: RefObject<RemoteLinkActions | null>;
  beat?: (body: BeatBody, signal?: AbortSignal) => Promise<BeatAnswer>;
  notify?: (message: string) => void;
  /** Web Locks: only the tab holding LINK_LOCK beats (others wait). */
  locks?: Locks | null;
  /** navigator.sendBeacon, for the goodbye on pagehide. */
  beacon?: (url: string, body: Blob) => boolean;
}) {
  const locksRef = useRef(locks);
  const beaconRef = useRef(beacon);
  useEffect(() => {
    locksRef.current = locks;
    beaconRef.current = beacon;
  }, [locks, beacon]);
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
    /** The beat the server is holding, to cut short on a change here. */
    let held: AbortController | null = null;
    /** The last held beat came back at once with no news. */
    let tooSoon = false;

    const plan = (now: number) => {
      const st = usePlayerStore.getState();
      return nextBeat({
        hasTrack: !!st.queue[st.index],
        isPlaying: st.isPlaying,
        watchers,
        pausedForMs: st.isPlaying ? 0 : now - pausedSince,
        hidden: typeof document !== 'undefined' && document.hidden,
      });
    };

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
      const next = plan(now);
      // A held beat that came straight back is not held again at once.
      const delay = next ? (next.hold && tooSoon ? Math.max(next.delay, BEAT_WATCHED_MS) : next.delay) : null;
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
        // News here: the beat the server holds is cut short, and this one
        // follows it.
        held?.abort();
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
      const key = `${full.trackId}|${full.queueHash}|${full.loopMode}|${full.shuffle}|${JSON.stringify(full.context)}|${full.upNext.length}`;
      const sendFull = wantFull || key !== lastFullKey;
      const sending = acked;
      acked = [];
      const hold = !!plan(now)?.hold;
      const body: BeatBody = {
        ...identity!,
        instance: TAB_INSTANCE,
        acked: sending,
        ...(sendFull ? { full } : { light: lightOf(full) }),
        ...(hold ? { hold: true } : {}),
      };
      const ctrl = hold ? new AbortController() : null;
      held = ctrl;
      inFlight = true;
      try {
        const answer = await beatRef.current(body, ctrl?.signal);
        if (disposed) return;
        backoff.ok();
        tooSoon = hold && Date.now() - now < HELD_TOO_SOON_MS && answer.commands.length === 0
          && answer.watchers === 0 && !answer.want && !answer.yield;
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
        // Cut short on purpose (a change here): not a failure.
        if (!ctrl?.signal.aborted) backoff.fail(retryAfterOf(e));
      } finally {
        inFlight = false;
        if (held === ctrl) held = null;
        beaten = true;
      }
      if (again) {
        // The change's own beat comes next, and schedules after itself.
        again = false;
        change(true);
        return;
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
      // The change's beat stands in for the next one on the cadence.
      clearTimer();
      debounce = setTimeout(() => {
        debounce = null;
        void send();
      }, CHANGE_DEBOUNCE_MS);
    }

    let lastKey = playStateKey(usePlayerStore.getState());
    let lastQueue = usePlayerStore.getState().queue;
    let lastPos = { pos: usePlayerStore.getState().position, at: Date.now(), playing: usePlayerStore.getState().isPlaying };
    let unsubscribe = () => {};
    const listen = () => usePlayerStore.subscribe((s) => {
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

    /** The page goes away: the server hears at once that nothing plays here
     *  any more, rather than 35 s later. */
    const onPageHide = () => {
      if (!started || !beaten) return;
      const light = { ...lightOf(buildSnapshot(usePlayerStore.getState())), isPlaying: false };
      const body: BeatBody = { ...identity!, instance: TAB_INSTANCE, acked: [], light, bye: true };
      try {
        beaconRef.current(apiUrl('/api/remote/beat'), new Blob([JSON.stringify(body)], { type: 'application/json' }));
      } catch {
        // Nothing to do on a page that is leaving.
      }
    };
    /** Back to the page (a tab shown again, or out of the back/forward
     *  cache): an open, idle device beats again so it can be reached. */
    const onShow = () => {
      if (started && !document.hidden && !inFlight && !timer) change(true);
    };

    let started = false;
    let beaten = false;
    const start = () => {
      if (disposed || started) return;
      started = true;
      unsubscribe = listen();
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('pageshow', onShow);
      document.addEventListener('visibilitychange', onShow);
      void send();
    };

    // One tab of the browser beats for the device: the one that holds the
    // lock. Another waits for it (the first closing hands it over).
    const lockAbort = new AbortController();
    let releaseLock: (() => void) | null = null;
    const lockManager = locksRef.current;
    if (lockManager) {
      void lockManager.request(LINK_LOCK, { signal: lockAbort.signal }, () => new Promise<void>((resolve) => {
        releaseLock = resolve;
        if (disposed) resolve();
        else start();
      })).catch(() => {});
    } else {
      start();
    }

    return () => {
      disposed = true;
      held?.abort();
      unsubscribe();
      clearTimer();
      if (debounce) clearTimeout(debounce);
      if (started) {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onShow);
        document.removeEventListener('visibilitychange', onShow);
      }
      lockAbort.abort();
      (releaseLock as (() => void) | null)?.();
      releaseSingleton('remote-link', owner);
    };
  }, [enabled, identity, actionsRef]);
}
