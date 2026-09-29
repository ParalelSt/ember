'use client';

import { toast } from 'sonner';
import { logger } from '@/lib/logger/client';
import { detectShell } from '@/lib/playback/detectShell';
import { useCastStore } from '@/stores/useCastStore';
import { castPath, currentCastEnv } from './detect';
import { castGlobals, googleRemote, loadCastSdk, type GCastGlobals } from './googleCast';
import { castSessionEnded, castSessionStarted } from './session';

/** Casting, one per page: finds out how this page can cast (lib/cast/detect),
 *  keeps useCastStore current for the Cast button, and opens the device
 *  picker when it is tapped. The player itself only hears about Google Cast
 *  sessions (lib/cast/session): AirPlay moves the page's own audio element,
 *  and the Android app casts natively, with the same queue and controls. */

/** Set once this browser has cast: from then on the SDK loads at start, so
 *  a reload rejoins a session that is still playing, and the button follows
 *  real device availability. */
const USED_KEY = 'ember.cast.used';

/** The EmberPlayer plugin's Cast surface (apps/mobile, Kotlin). Absent on
 *  app builds from before casting. */
interface AndroidCastState {
  available: boolean;
  connecting?: boolean;
  connected: boolean;
  deviceName?: string | null;
}
interface AndroidCastPlugin {
  getCastState(): Promise<AndroidCastState>;
  showCastPicker(): Promise<void>;
  addListener(event: 'cast', cb: (s: AndroidCastState) => void): unknown;
}

function androidCastPlugin(): AndroidCastPlugin | null {
  if (typeof window === 'undefined') return null;
  const p = (window as unknown as { Capacitor?: { Plugins?: { EmberPlayer?: Partial<AndroidCastPlugin> } } })
    .Capacitor?.Plugins?.EmberPlayer;
  return p && typeof p.getCastState === 'function' && typeof p.showCastPicker === 'function'
    ? (p as AndroidCastPlugin)
    : null;
}

let started = false;
let airplayEl: HTMLMediaElement | null = null;
let airplayCleanup: (() => void) | null = null;

/** Starts watching for devices. Safe to call more than once. */
export function initCast(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const path = castPath(currentCastEnv(detectShell(), !!androidCastPlugin()));
  useCastStore.getState().set({ path, availability: path === 'google' ? 'unknown' : 'none' });
  if (path === 'android') initAndroid();
  else if (path === 'google') initGoogle();
  else if (path === 'airplay' && airplayEl) watchAirplay(airplayEl);
}

/** Tests only. */
export function _resetCast(): void {
  started = false;
  googleReady = null;
  airplayCleanup?.();
  airplayCleanup = null;
  airplayEl = null;
}

/** The Cast button. */
export async function requestCast(): Promise<void> {
  const { path, connection } = useCastStore.getState();
  try {
    if (path === 'android') {
      await androidCastPlugin()?.showCastPicker();
    } else if (path === 'airplay') {
      const remote = (airplayEl as (HTMLMediaElement & { remote?: RemotePlayback }) | null)?.remote;
      if (!remote) throw new Error('no audio to send');
      await remote.prompt();
    } else if (path === 'google') {
      const g = await ensureGoogle();
      if (!g) {
        toast.error('Casting is not available in this browser right now.');
        return;
      }
      const ctx = g.cast.framework.CastContext.getInstance();
      if (connection === 'connected') {
        ctx.endCurrentSession(true);
        return;
      }
      await ctx.requestSession();
    }
  } catch (e) {
    // Closing the picker is not a failure.
    const msg = typeof e === 'string' ? e : e instanceof Error ? `${e.name} ${e.message}` : String(e);
    if (/cancel|abort/i.test(msg)) return;
    logger.error('cast', 'could not open the cast picker', { path }, e instanceof Error ? e : new Error(msg));
    toast.error('Could not start casting. Try again.');
  }
}

/** Stops casting: the Devices picker's "Stop casting", or a speaker on this
 *  device picked while casting. The music comes back here (the player's
 *  hand-back, as when the TV ends the session). AirPlay has no call for it:
 *  its own picker moves it back. */
export async function stopCast(): Promise<void> {
  const { path, connection } = useCastStore.getState();
  if (connection === 'idle') return;
  try {
    if (path === 'android') {
      const p = androidCastPlugin() as (AndroidCastPlugin & { stopCasting?: () => Promise<void> }) | null;
      // An app build from before the Devices picker: the device's own
      // controls have "Stop casting".
      if (typeof p?.stopCasting === 'function') await p.stopCasting();
      else await p?.showCastPicker();
    } else if (path === 'google') {
      castGlobals()?.cast.framework.CastContext.getInstance().endCurrentSession(true);
    }
  } catch (e) {
    logger.error('cast', 'could not stop casting', { path }, e instanceof Error ? e : new Error(String(e)));
    toast.error('Could not stop casting. Try again.');
  }
}

// ── Google Cast (Chrome) ────────────────────────────────────────────────

let googleReady: Promise<GCastGlobals | null> | null = null;

function initGoogle(): void {
  let used = false;
  try {
    used = window.localStorage.getItem(USED_KEY) === '1';
  } catch {
    /* storage blocked */
  }
  if (used) {
    void ensureGoogle();
    return;
  }
  void probeDevices();
}

/** Whether a Cast device is around, before (and without) the SDK: Chrome
 *  answers this for Cast URLs through the Presentation API. Browsers that
 *  will not say leave the button showing ('unknown'). */
async function probeDevices(): Promise<void> {
  const Req = (window as unknown as { PresentationRequest?: new (urls: string[]) => { getAvailability(): Promise<{ value: boolean; onchange: (() => void) | null }> } }).PresentationRequest;
  if (!Req) return;
  try {
    const clientId = Math.floor(Math.random() * 1e9);
    const availability = await new Req([`cast:CC1AD845?clientId=${clientId}`]).getAvailability();
    const apply = () => {
      if (castGlobals()) return; // the SDK's own state wins once it is here
      useCastStore.getState().set({ availability: availability.value ? 'available' : 'none' });
    };
    availability.onchange = apply;
    apply();
  } catch {
    /* not supported here: stay 'unknown' */
  }
}

function ensureGoogle(): Promise<GCastGlobals | null> {
  if (googleReady) return googleReady;
  const attempt = loadCastSdk().then((ok) => {
    const g = ok ? castGlobals() : null;
    if (!g) return null;
    setUpGoogle(g);
    return g;
  });
  googleReady = attempt;
  void attempt.then((g) => {
    if (!g && googleReady === attempt) googleReady = null;
  });
  return attempt;
}

function setUpGoogle(g: GCastGlobals): void {
  const f = g.cast.framework;
  const ctx = f.CastContext.getInstance();
  ctx.setOptions({
    receiverApplicationId: g.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    // Rejoin a session this tab started, after a reload. Not other tabs:
    // two pages both driving one TV would each move it to their own queue.
    autoJoinPolicy: g.chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED,
  });
  try {
    window.localStorage.setItem(USED_KEY, '1');
  } catch {
    /* storage blocked: the SDK just loads on the next tap again */
  }
  const deviceName = () => ctx.getCurrentSession()?.getCastDevice()?.friendlyName || 'your TV';
  const applyState = (state: string) => {
    const S = f.CastState;
    useCastStore.getState().set({
      availability: state === S.NO_DEVICES_AVAILABLE ? 'none' : 'available',
      connection: state === S.CONNECTED ? 'connected' : state === S.CONNECTING ? 'connecting' : 'idle',
      deviceName: state === S.CONNECTED ? deviceName() : null,
    });
  };
  ctx.addEventListener(f.CastContextEventType.CAST_STATE_CHANGED, (e: { castState: string }) => applyState(e.castState));
  ctx.addEventListener(f.CastContextEventType.SESSION_STATE_CHANGED, (e: { sessionState: string }) => {
    const S = f.SessionState;
    const session = ctx.getCurrentSession();
    if ((e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED) && session) {
      castSessionStarted(googleRemote(g, session), deviceName(), e.sessionState === S.SESSION_RESUMED);
    } else if (e.sessionState === S.SESSION_ENDED) {
      castSessionEnded();
    } else if (e.sessionState === S.SESSION_START_FAILED) {
      toast.error('Could not connect to the cast device.');
    }
  });
  applyState(ctx.getCastState());
  // Joined while setting up (a reload mid-session).
  const session = ctx.getCurrentSession();
  if (session) castSessionStarted(googleRemote(g, session), deviceName(), true);
}

// ── AirPlay (Safari) ────────────────────────────────────────────────────

/** The page's audio element, for AirPlay: Safari moves the element itself
 *  to the speaker or TV, so the player keeps running as it is. Called by
 *  the player with the web engine's element (null when there is none). */
export function setCastMediaElement(el: HTMLMediaElement | null): void {
  if (el === airplayEl) return;
  airplayCleanup?.();
  airplayCleanup = null;
  airplayEl = el;
  if (el && started && useCastStore.getState().path === 'airplay') watchAirplay(el);
}

function watchAirplay(el: HTMLMediaElement): void {
  const remote = (el as HTMLMediaElement & { remote?: RemotePlayback }).remote;
  if (!remote) return;
  const set = useCastStore.getState().set;
  const onState = () => set({
    connection: remote.state === 'connected' ? 'connected' : remote.state === 'connecting' ? 'connecting' : 'idle',
    deviceName: remote.state === 'connected' ? 'AirPlay' : null,
  });
  remote.addEventListener('connect', onState);
  remote.addEventListener('connecting', onState);
  remote.addEventListener('disconnect', onState);
  let watchId: number | null = null;
  remote
    .watchAvailability((available) => set({ availability: available ? 'available' : 'none' }))
    .then((id) => {
      watchId = id;
    })
    .catch(() => set({ availability: 'unknown' }));
  onState();
  airplayCleanup = () => {
    remote.removeEventListener('connect', onState);
    remote.removeEventListener('connecting', onState);
    remote.removeEventListener('disconnect', onState);
    if (watchId !== null) void remote.cancelWatchAvailability(watchId).catch(() => {});
  };
}

// ── Android app ─────────────────────────────────────────────────────────

function initAndroid(): void {
  const p = androidCastPlugin();
  if (!p) return;
  const apply = (s: AndroidCastState | null | undefined) => {
    if (!s) return;
    useCastStore.getState().set({
      availability: s.available || s.connected ? 'available' : 'none',
      connection: s.connected ? 'connected' : s.connecting ? 'connecting' : 'idle',
      deviceName: s.connected ? s.deviceName || 'your TV' : null,
    });
  };
  try {
    void Promise.resolve(p.addListener('cast', apply)).catch(() => {});
  } catch {
    /* a broken bridge must not break the player */
  }
  void p.getCastState().then(apply, () => {});
}
