'use client';

import type { CastMedia, CastRemote, CastRemoteStatus } from '@/lib/playback/castBackend';

/** Google's Cast Web Sender SDK (CAF), typed as far as Ember uses it. There
 *  is no npm package: the SDK only exists as Google's hosted script. */
export const CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface GCastMediaSession {
  playerState?: string;
  idleReason?: string | null;
  addUpdateListener?(cb: (alive: boolean) => void): void;
}
export interface GCastSession {
  loadMedia(req: unknown): Promise<unknown>;
  getMediaSession(): GCastMediaSession | null;
  getCastDevice(): { friendlyName?: string } | null;
  endSession(stopCasting: boolean): void;
}
export interface GCastContext {
  setOptions(o: Record<string, unknown>): void;
  addEventListener(type: string, cb: (e: any) => void): void;
  getCastState(): string;
  getCurrentSession(): GCastSession | null;
  requestSession(): Promise<unknown>;
  endCurrentSession(stopCasting: boolean): void;
}
export interface GCastGlobals {
  cast: {
    framework: {
      CastContext: { getInstance(): GCastContext };
      CastContextEventType: { CAST_STATE_CHANGED: string; SESSION_STATE_CHANGED: string };
      CastState: { NO_DEVICES_AVAILABLE: string; NOT_CONNECTED: string; CONNECTING: string; CONNECTED: string };
      SessionState: { SESSION_STARTED: string; SESSION_RESUMED: string; SESSION_ENDED: string; SESSION_START_FAILED: string };
      RemotePlayer: new () => any;
      RemotePlayerController: new (player: any) => any;
      RemotePlayerEventType: { ANY_CHANGE: string };
    };
  };
  chrome: {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: string };
      Image: new (url: string) => unknown;
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (contentId: string, contentType: string) => any;
        MusicTrackMediaMetadata: new () => any;
        LoadRequest: new (info: unknown) => any;
        StreamType: { BUFFERED: string };
      };
    };
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

let sdkLoad: Promise<boolean> | null = null;

/** The SDK's globals once loaded, else null. */
export function castGlobals(): GCastGlobals | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Partial<GCastGlobals>;
  if (!w.cast?.framework || !w.chrome?.cast?.media) return null;
  return w as GCastGlobals;
}

/** Loads Google's sender script from gstatic, once. Only ever called on a
 *  tap on the Cast button (or, on a browser that has cast before, at
 *  start, to rejoin a session that is still playing). Resolves false when
 *  the SDK cannot load or says Cast is unavailable; a later call tries
 *  again. */
export function loadCastSdk(timeoutMs = 15_000): Promise<boolean> {
  if (castGlobals()) return Promise.resolve(true);
  if (sdkLoad) return sdkLoad;
  const attempt = new Promise<boolean>((resolve) => {
    const w = window as unknown as { __onGCastApiAvailable?: (ok: boolean) => void };
    const timer = setTimeout(() => resolve(false), timeoutMs);
    w.__onGCastApiAvailable = (ok) => {
      clearTimeout(timer);
      resolve(!!ok && !!castGlobals());
    };
    const s = document.createElement('script');
    s.src = CAST_SDK_URL;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    document.head.appendChild(s);
  });
  sdkLoad = attempt;
  void attempt.then((ok) => {
    if (!ok && sdkLoad === attempt) sdkLoad = null;
  });
  return attempt;
}

/** Tests only. */
export function _resetCastSdk(): void {
  sdkLoad = null;
}

const IDLE_REASONS: Record<string, CastRemoteStatus['idleReason']> = {
  FINISHED: 'finished',
  ERROR: 'error',
  INTERRUPTED: 'interrupted',
  CANCELLED: 'cancelled',
};

/** Builds the receiver's load request for one song: the Default Media
 *  Receiver shows title, artist, album and the cover on the TV. */
export function buildLoadRequest(g: GCastGlobals, media: CastMedia, opts: { startAt: number; autoplay: boolean }): unknown {
  const m = g.chrome.cast.media;
  const info = new m.MediaInfo(media.url, media.contentType);
  info.streamType = m.StreamType.BUFFERED;
  const meta = new m.MusicTrackMediaMetadata();
  meta.title = media.title;
  meta.artist = media.artist;
  if (media.album) meta.albumName = media.album;
  if (media.artworkUrl) meta.images = [new g.chrome.cast.Image(media.artworkUrl)];
  info.metadata = meta;
  const req = new m.LoadRequest(info);
  req.autoplay = opts.autoplay;
  req.currentTime = Math.max(0, opts.startAt);
  return req;
}

/** A CastRemote over one Google Cast session: RemotePlayer for the state
 *  and the controls, the session's media for why it went idle. */
export function googleRemote(g: GCastGlobals, session: GCastSession): CastRemote {
  const f = g.cast.framework;
  const player = new f.RemotePlayer();
  const controller = new f.RemotePlayerController(player);
  const subs = new Set<(s: CastRemoteStatus) => void>();

  const status = (): CastRemoteStatus => {
    const ps = String(player.playerState ?? '');
    const state: CastRemoteStatus['state'] =
      ps === 'PLAYING' ? 'playing' : ps === 'PAUSED' ? 'paused' : ps === 'BUFFERING' ? 'buffering' : 'idle';
    const reason = session.getMediaSession()?.idleReason;
    return {
      state,
      time: Number(player.currentTime) || 0,
      duration: Number(player.duration) || 0,
      idleReason: state === 'idle' && reason ? IDLE_REASONS[reason] ?? null : null,
      contentId: typeof player.mediaInfo?.contentId === 'string' ? player.mediaInfo.contentId : null,
    };
  };
  const emit = () => {
    const s = status();
    for (const cb of subs) cb(s);
  };
  controller.addEventListener(f.RemotePlayerEventType.ANY_CHANGE, emit);

  return {
    async load(media, opts) {
      const failed = await session.loadMedia(buildLoadRequest(g, media, opts));
      if (failed) throw new Error(`cast load failed: ${String(failed)}`);
      session.getMediaSession()?.addUpdateListener?.(() => emit());
    },
    play() {
      if (player.isPaused) controller.playOrPause();
    },
    pause() {
      if (!player.isPaused) controller.playOrPause();
    },
    seek(sec) {
      player.currentTime = sec;
      controller.seek();
    },
    stop() {
      controller.stop();
    },
    setVolume(v) {
      if (player.canControlVolume === false) return;
      player.volumeLevel = v;
      controller.setVolumeLevel();
    },
    status,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
