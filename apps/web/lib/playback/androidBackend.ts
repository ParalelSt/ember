'use client';

import { logger } from '@/lib/logger/client';
import { nativeQueueContext, type QueueOrigin } from '@/lib/autoCache/native';
import type { Track } from '@/types/track';
import type { LoopMode } from '@/stores/usePlayerStore';
import type { OverlayEnd, OverlayHandle, OverlayResult } from '@/lib/pranks/overlayPlayer';
import type { AudioBackend, AudioBackendEvents, CreateAudioBackend, NativeOverlayOptions } from './types';
import type { UnplayableNotice, UnplayableOutcome } from './unplayable';

/** JS surface of the EmberPlayer Capacitor plugin (apps/mobile, Kotlin).
 *  Reached through the bridge Capacitor injects, never imported from npm:
 *  this web app is served by the host, so no plugin JS is ever bundled. */
interface NativeState {
  playing: boolean;
  position: number;
  duration: number;
  index: number;
  trackId: string | null;
  /** App builds from before the loop button reached native lack it. */
  loop?: LoopMode;
  /** Whether native's queue is shuffled (the car's Shuffle button, or ours).
   *  App builds from before the car's shuffle reached the app report the
   *  player's own flag, which the app never set. */
  shuffle?: boolean;
  /** The play history (song ids, oldest first): app builds from before the
   *  queue sheet's "Played" list leave it out. */
  played?: string[];
  /** When native read this state (ms, the phone's clock). App builds from
   *  before the screen-off fix leave it out. */
  at?: number;
}
interface EmberPlayerPlugin {
  addListener(event: string, cb: (data: never) => void): unknown;
  /** `context`/`baseCount` feed the native auto cache's window; older app
   *  builds ignore them. */
  setQueue(o: {
    tracks: Track[];
    index: number;
    play: boolean;
    context?: { type: string } | null;
    baseCount?: number;
    /** Where the song starts; older app builds ignore it (start at 0). */
    startSec?: number;
  }): Promise<void>;
  play(): Promise<void>;
  /** "Tap to retry": reloads the failed song with the host's retry mark.
   *  Absent on app builds from before it (they only have play). */
  retry?(): Promise<void>;
  pause(): Promise<void>;
  seek(o: { sec: number }): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Back through the play history to queue entry `index`. Absent on app
   *  builds from before the queue sheet's "Played" list. */
  back?(o: { index: number }): Promise<void>;
  /** Absent on app builds from before the loop button reached native. */
  setRepeat?(o: { mode: LoopMode }): Promise<void>;
  /** Absent on app builds from before the car's shuffle reached the app. */
  setShuffle?(o: { on: boolean; order?: string[]; restore?: boolean }): Promise<void>;
  setVolume(o: { v: number }): Promise<void>;
  /** Absent on app builds from before native volume normalization. */
  setNormalize?(o: { enabled: boolean }): Promise<void>;
  /** Absent on app builds from before the native equalizer. */
  setEqualizer?(o: { enabled: boolean; bands: number[] }): Promise<void>;
  getState(): Promise<NativeState>;
  /** What native is playing from. Absent on app builds from before it. */
  getQueue?(): Promise<{ tracks: Track[]; index: number }>;
  /** Only on app builds with the native prank overlay. */
  playOverlay?(o: NativeOverlayOptions & { id: string; url: string }): Promise<{ started: boolean; reason?: string }>;
  stopOverlay?(): Promise<void>;
  /** App builds that report failed songs themselves (the `unplayable`
   *  event). Hands over the ones held while no page was listening. */
  drainUnplayable?(): Promise<{ notices?: unknown[] }>;
}
interface OverlayEvent {
  id: string;
  phase: 'ended';
  reason: string;
  playedSec: number;
}

const OVERLAY_ENDS: readonly OverlayEnd[] = ['ended', 'stopped', 'cap', 'error'];
const OUTCOMES: readonly UnplayableOutcome[] = ['skipped', 'stopped', 'gave-up', 'flagged'];

/** One `unplayable` entry from native, checked field by field: a malformed
 *  one is dropped rather than shown as a broken sentence. */
export function parseNotice(raw: unknown): UnplayableNotice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.trackId !== 'string' || !r.trackId) return null;
  const outcome = OUTCOMES.find((o) => o === r.outcome);
  if (!outcome) return null;
  return {
    trackId: r.trackId,
    title: typeof r.title === 'string' ? r.title : '',
    kind: r.kind === 'unavailable' ? 'unavailable' : 'transient',
    reason: typeof r.reason === 'string' && r.reason ? r.reason : null,
    outcome,
  };
}

function parseNotices(d: { notices?: unknown } | null | undefined): UnplayableNotice[] {
  return Array.isArray(d?.notices) ? d.notices.map(parseNotice).filter((n): n is UnplayableNotice => n !== null) : [];
}
const LOOP_MODES: readonly LoopMode[] = ['off', 'all', 'one'];
/** A state native read longer ago than this was held up on its way here (a
 *  frozen page, see below), not merely late: the page asks for a fresh one. */
export const STALE_STATE_MS = 3_000;
/** A resync whose answer never comes stops holding state events back after
 *  this long, so a hung bridge cannot freeze the bar for good. */
export const RESYNC_GIVE_UP_MS = 15_000;
/** If native never reports the end (the service died), give up this long
 *  after the cap so the receiver is not busy forever. */
export const OVERLAY_END_GRACE_MS = 5_000;

function plugin(): EmberPlayerPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { EmberPlayer?: EmberPlayerPlugin } } }).Capacitor;
  return cap?.Plugins?.EmberPlayer ?? null;
}

export function androidPluginPresent(): boolean {
  return plugin() !== null;
}

/** A missing or broken bridge must never throw into the player. */
function call(p: unknown): void {
  if (p && typeof (p as Promise<void>).catch === 'function') void (p as Promise<void>).catch(() => {});
}

/** Android backend: the native Media3 player owns playback AND the queue, so
 *  the car keeps working when this WebView is gone. This object only forwards
 *  commands and mirrors what native reports. There is deliberately no fallback
 *  to WebView audio here: that path cannot drive the car and would hide the
 *  fault. */
export const createAndroidBackend: CreateAudioBackend = (events: AudioBackendEvents) => {
  let position = 0;
  let duration = 0;
  let paused = true;
  let index = -1;
  /** The loop mode native last reported (null until it first does), and the
   *  modes sent since that it has not reported yet. A report that matches one
   *  of those is our own change arriving, not a tap in the car, so it is not
   *  echoed back: echoing a stale one would fight the listener's latest tap. */
  let loop: LoopMode | null = null;
  let loopsInFlight: LoopMode[] = [];
  /** The same for shuffle: native's last report, and our sends not yet
   *  reported back. Only an app build with setShuffle reports a shuffle
   *  that means anything, so an older one is never listened to. */
  let shuffled: boolean | null = null;
  let shufflesInFlight: boolean[] = [];
  /** The order last sent with shuffle on: a new list shuffled (shuffle
   *  already on) sends its own order, or the car's off would put the new
   *  list in the old one's order. */
  let orderSent = '';
  const p = plugin();
  const nativeShuffle = !!p && typeof p.setShuffle === 'function';
  const nativeExplains = !!p && typeof p.drainUnplayable === 'function';

  const onShuffleReport = (on: boolean | undefined) => {
    if (!nativeShuffle || typeof on !== 'boolean' || on === shuffled) return;
    const first = shuffled === null;
    shuffled = on;
    const mine = shufflesInFlight.indexOf(on);
    if (mine >= 0) {
      shufflesInFlight = shufflesInFlight.slice(mine + 1);
      return;
    }
    // The first report is what native had before this page (the car
    // shuffled while the app was closed). Unlike the loop mode, the page has
    // no shuffle of its own to send over it (a reload starts unshuffled), so
    // a shuffled native is mirrored; an unshuffled one is what the page has.
    if (first) {
      if (on) events.onShuffle?.(true, { initial: true });
      return;
    }
    shufflesInFlight = [];
    events.onShuffle?.(on);
  };

  const onLoop = (l: LoopMode | undefined) => {
    if (!l || !LOOP_MODES.includes(l) || l === loop) return;
    const first = loop === null;
    loop = l;
    const mine = loopsInFlight.indexOf(l);
    if (mine >= 0) {
      loopsInFlight = loopsInFlight.slice(mine + 1);
      return;
    }
    // The first report is only what native had when this WebView started;
    // the app's own saved mode is sent over it.
    if (first) return;
    loopsInFlight = [];
    events.onLoopMode?.(l);
  };

  /** The song native last said it was on: the one a bare `error` (an app
   *  build that does not explain failures) is about. */
  let trackId: string | null = null;
  /** The play history native last reported, joined (only a change is passed on). */
  let playedKey: string | null = null;

  /** Catching up after the page was away (hidden, or frozen by the WebView).
   *
   *  Chromium freezes a hidden page that plays no sound of its own after a
   *  few minutes, and Ember's music plays natively, so the page is silent:
   *  with the screen off, every state event native sent waited in line, and
   *  when the screen came back on the page replayed them all, minutes of
   *  positions at 4 a second. The bar raced through songs long finished
   *  while the right one played, and the page was too busy to draw (a black
   *  screen) or let a tap navigate (bug report 2026-10-09).
   *
   *  So on coming back (and on any state that says it is old) the page asks
   *  native for its state, and drops every state event until the answer
   *  lands: the answer comes down the same line as the events, after all the
   *  held ones, so everything before it is older than it. */
  let resyncing = false;
  let resyncSeq = 0;
  let resyncTimer: ReturnType<typeof setTimeout> | undefined;
  const resync = () => {
    if (!p || resyncing) return;
    resyncing = true;
    const seq = ++resyncSeq;
    const done = (s: NativeState | null) => {
      if (seq !== resyncSeq) return;
      clearTimeout(resyncTimer);
      resyncing = false;
      if (s && typeof s === 'object') applyState(s);
    };
    resyncTimer = setTimeout(() => done(null), RESYNC_GIVE_UP_MS);
    let answer: Promise<NativeState>;
    try {
      answer = p.getState();
    } catch {
      done(null);
      return;
    }
    Promise.resolve(answer).then(done, () => done(null));
  };
  const onState = (s: NativeState) => {
    if (resyncing) return;
    // Only an app build that dates its states (see NativeState.at).
    if (typeof s?.at === 'number' && Date.now() - s.at > STALE_STATE_MS) {
      resync();
      return;
    }
    applyState(s);
  };
  const applyState = (s: NativeState) => {
    paused = !s.playing;
    trackId = s.trackId ?? null;
    if (s.index !== index) {
      index = s.index;
      events.onQueueIndex?.(s.index);
    }
    if (s.duration !== duration) {
      duration = s.duration;
      events.onDuration(s.duration);
    }
    position = s.position;
    events.onTime(s.position);
    onLoop(s.loop);
    onShuffleReport(s.shuffle);
    if (Array.isArray(s.played)) {
      const ids = s.played.filter((id): id is string => typeof id === 'string');
      const key = ids.join('\u0000');
      if (key !== playedKey) {
        playedKey = key;
        events.onPlayed?.(ids);
      }
    }
    // Re-assert on every event, not only when our own mirror flips: native is
    // the source of truth here, and anything else that writes the store's
    // playing flag (an error toast, a stale closure) would otherwise leave the
    // bar out of step until the next real flip. The provider ignores repeats.
    if (s.playing) events.onPlay();
    else events.onPause();
  };

  // Old app builds have no overlay methods at all: Capacitor's plugin object
  // only carries the methods the installed APK registered.
  const nativeOverlay = !!p && typeof p.playOverlay === 'function';
  let overlaySeq = 0;
  const overlayEnds = new Map<string, (r: OverlayResult) => void>();
  const settleOverlay = (id: string, r: OverlayResult) => {
    const end = overlayEnds.get(id);
    overlayEnds.delete(id);
    end?.(r);
  };

  if (p) {
    if (nativeOverlay) {
      call(
        p.addListener('overlay', ((d: OverlayEvent) => {
          if (d?.phase !== 'ended') return;
          const reason = OVERLAY_ENDS.includes(d.reason as OverlayEnd) ? (d.reason as OverlayEnd) : 'error';
          const played = Number(d.playedSec);
          settleOverlay(d.id, { reason, playedSec: Number.isFinite(played) ? Math.max(0, played) : 0 });
        }) as (d: never) => void),
      );
    }
    call(p.addListener('state', onState as (d: never) => void));
    call(
      p.addListener('queue', ((d: { tracks: Track[]; index: number; shuffle?: boolean }) => {
        index = d.index;
        // The flag comes first from native (session extras before the
        // queue); a report of it here is only news when the state event has
        // not carried it yet.
        if (nativeShuffle && typeof d.shuffle === 'boolean') onShuffleReport(d.shuffle);
        events.onQueueReplaced?.(d.tracks, d.index, nativeShuffle && typeof d.shuffle === 'boolean' ? { shuffle: d.shuffle } : undefined);
      }) as (d: never) => void),
    );
    call(p.addListener('ended', (() => events.onEnded()) as (d: never) => void));
    call(
      p.addListener('error', ((d: { message?: string }) => {
        logger.error('audio', d?.message || 'native player error');
        events.onError({ trackId, nativeExplains });
      }) as (d: never) => void),
    );
    if (nativeExplains) {
      const deliver = (d: { notices?: unknown } | null | undefined, away: boolean) => {
        const notices = parseNotices(d);
        if (!notices.length) return;
        if (away) events.onUnplayable?.(notices, { away: true });
        else events.onUnplayable?.(notices);
      };
      call(p.addListener('unplayable', ((d: { notices?: unknown }) => deliver(d, false)) as (d: never) => void));
      // Songs that failed while no page was listening (the app closed, the
      // WebView re-created): native kept them for this moment, and the bar
      // says them as "while you were away".
      void p.drainUnplayable!().then((d) => deliver(d, true), () => {});
    }
  }

  /** A page that starts while native already plays (reopened after the car,
   *  or after the app was swiped away while the music went on) must not push
   *  its saved queue over what native is doing: that jumped the music back
   *  to whatever this page last saw. So a paused hand-over (only a page
   *  restoring its saved queue sends one before it has heard from native)
   *  waits until native has said what it has. Native playing something:
   *  this page takes native's queue instead. Native empty (a fresh start):
   *  the saved queue goes over, paused, as before. A tap (play) never waits.
   *  A bridge that fails to answer sends the saved queue. */
  type Held = { tracks: Track[]; i: number; origin?: QueueOrigin; startSec?: number };
  let settled = !p;
  let held: Held | null = null;
  const send = (h: Held, play: boolean) => {
    if (!p) return;
    const at = h.startSec && h.startSec > 0 ? { startSec: h.startSec } : {};
    call(p.setQueue({ tracks: h.tracks, index: h.i, play, ...nativeQueueContext(h.origin), ...at }));
  };
  const settle = (s: NativeState | null, q: { tracks: Track[]; index: number } | null) => {
    if (settled) return;
    settled = true;
    const h = held;
    held = null;
    const nativeHas = !!s && s.index >= 0 && !!s.trackId;
    if (h && nativeHas) {
      const same = (a: Track[], b: Track[]) => a.length === b.length && a.every((t, k) => t.id === b[k]?.id);
      if (q && q.tracks.length > 0 && !same(q.tracks, h.tracks)) {
        index = q.index;
        events.onQueueReplaced?.(q.tracks, q.index);
      } else if (!q && h.tracks[s!.index]?.id !== s!.trackId) {
        // An app build that cannot say its queue: the saved one it is.
        send(h, false);
      }
    } else if (h) {
      send(h, false);
    }
    if (s) applyState(s);
  };
  // Back on screen: native's state now, not the line of old ones the page
  // may be about to replay. 'resume' is the page coming out of a freeze.
  const onShown = () => {
    if (document.visibilityState === 'visible') resync();
  };
  if (p && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onShown);
    document.addEventListener('resume', onShown);
  }

  // No time limit: a slow answer (the player service still binding on a
  // busy cold start) is exactly when native may already be playing, and
  // guessing "empty" then pushed the saved queue over it. Only a failed
  // call means there is nothing to protect.
  if (p) {
    // Catch up on whatever native is already doing: the UI may have been
    // re-created while the car kept playing.
    void (async () => {
      const s = await p.getState();
      const q = typeof p.getQueue === 'function' ? await p.getQueue().catch(() => null) : null;
      settle(s, q);
    })().catch(() => settle(null, null));
  }

  const overlay: Pick<AudioBackend, 'playOverlay' | 'stopOverlay'> = nativeOverlay
    ? {
        playOverlay(url: string, opts: NativeOverlayOptions): OverlayHandle {
          const id = `o${++overlaySeq}`;
          const finished = new Promise<OverlayResult>((r) => overlayEnds.set(id, r));
          let grace: ReturnType<typeof setTimeout> | undefined;
          void finished.then(() => clearTimeout(grace));
          const started = p!
            .playOverlay!({ id, url, ...opts })
            .then(
              (r) => !!r?.started,
              () => false,
            )
            .then((ok) => {
              if (!ok) settleOverlay(id, { reason: 'error', playedSec: 0 });
              else grace = setTimeout(() => settleOverlay(id, { reason: 'cap', playedSec: opts.maxSec }), opts.maxSec * 1000 + OVERLAY_END_GRACE_MS);
              return ok;
            });
          return { started, finished };
        },
        stopOverlay() {
          call(p!.stopOverlay?.());
        },
      }
    : {};

  return {
    ...overlay,
    // Single-track load is not how this backend works; the provider calls
    // setQueue for queue-owning backends. Kept as a harmless no-op.
    load() {},
    setQueue(tracks, i, play, origin, startSec) {
      if (!p) return;
      if (!settled && !play) {
        held = { tracks, i, origin, startSec };
        return;
      }
      // Anything the listener did replaces a saved queue still waiting.
      held = null;
      send({ tracks, i, origin, startSec }, play);
    },
    play() {
      if (p) call(p.play());
    },
    retry() {
      if (p) call(p.retry ? p.retry() : p.play());
    },
    pause() {
      if (p) call(p.pause());
    },
    stop() {
      if (p) call(p.pause());
    },
    seek(sec) {
      position = Math.max(0, sec);
      if (p) call(p.seek({ sec: position }));
    },
    next() {
      if (p) call(p.next());
    },
    prev() {
      if (p) call(p.prev());
    },
    back(i) {
      if (p?.back) call(p.back({ index: i }));
    },
    setLoop(mode) {
      if (!p?.setRepeat) return;
      if (mode === (loopsInFlight[loopsInFlight.length - 1] ?? loop)) return;
      loopsInFlight.push(mode);
      call(p.setRepeat({ mode }));
    },
    setShuffle(on, order, restore) {
      if (!p?.setShuffle) return;
      // Native's own report (the car's button) coming back through the store,
      // or the page's unshuffled start before native has said anything: a
      // send then would unshuffle what the car shuffled.
      const last = shufflesInFlight.length > 0 ? shufflesInFlight[shufflesInFlight.length - 1] : (shuffled ?? false);
      const key = on && order ? order.join('\u0000') : '';
      const newOrder = on && !!order && key !== orderSent;
      if (on === last && !newOrder) return;
      if (on !== last) shufflesInFlight.push(on);
      orderSent = on && order ? key : '';
      call(p.setShuffle(on && order ? { on, order } : !on && restore ? { on, restore: true } : { on }));
    },
    setVolume(v) {
      if (p) call(p.setVolume({ v: Math.max(0, Math.min(1, v)) }));
    },
    setNormalize(enabled) {
      if (p?.setNormalize) call(p.setNormalize({ enabled }));
    },
    setEq(eq) {
      // Native keeps it (the car and the screen-off player follow it with
      // this WebView gone). An older app build has no such method.
      if (p?.setEqualizer) call(p.setEqualizer({ enabled: eq.enabled, bands: eq.bands }));
    },
    setMetadata() {
      /* Media3 draws the notification from the queue itself */
    },
    setRemoteCommands() {
      /* the OS talks to the native session directly; nothing to wire here */
    },
    getCurrentTime: () => position,
    getDuration: () => duration,
    isPaused: () => paused,
    isTransitioning: () => false,
    destroy() {
      // The native listeners die with the WebView; the native player keeps
      // playing.
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onShown);
        document.removeEventListener('resume', onShown);
      }
      clearTimeout(resyncTimer);
    },
  };
};
