'use client';

import { createWebBackend } from './webBackend';
import type { AudioBackendEvents, CreateAudioBackend, RemoteCommands } from './types';
import type { Track } from '@/types/track';

/** JS surface of @capgo/capacitor-media-session (mirrors the Web MediaSession
 *  API). Reached through the bridge Capacitor injects into the webview —
 *  NOT imported from npm: this web app is served by the host, so the plugin's
 *  JS package is never bundled. Types transcribed from the plugin's
 *  definitions.d.ts (v7.3.0). */
interface MediaSessionPlugin {
  setMetadata(options: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: { src: string; sizes?: string; type?: string }[];
  }): Promise<void>;
  setPlaybackState(options: { playbackState: 'none' | 'paused' | 'playing' }): Promise<void>;
  // NOTE: returns `unknown`, not Promise — when a Capacitor plugin method is
  // invoked WITH a callback argument, the injected bridge switches to
  // callback mode and returns a callback-ID string instead of a Promise.
  setActionHandler(
    options: { action: 'play' | 'pause' | 'seekbackward' | 'seekforward' | 'previoustrack' | 'nexttrack' | 'seekto' | 'stop' },
    handler: ((details: { action: string; seekTime?: number | null }) => void) | null,
  ): unknown;
  setPositionState(options: { duration?: number; playbackRate?: number; position?: number }): Promise<void>;
}

function plugin(): MediaSessionPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: { MediaSession?: MediaSessionPlugin } };
  }).Capacitor;
  return cap?.Plugins?.MediaSession ?? null;
}

/** Fire-and-forget: a missing/broken plugin must degrade to plain web
 *  behavior, never break playback. Duck-typed — Capacitor's bridge returns a
 *  Promise for normal methods but a callback-ID STRING for callback-taking
 *  methods (setActionHandler), so `.catch` must not be assumed. */
function call(p: unknown): void {
  if (p && typeof (p as Promise<void>).catch === 'function') {
    void (p as Promise<void>).catch(() => {});
  }
}

/** The shape `Capacitor.convertFileSrc` produces for an app-private file. */
function isLocalFileSrc(src: string): boolean {
  return src.includes('/_capacitor_file_/') || src.startsWith('capacitor://');
}

/** Reads a WebView-resolvable URL into a data: URL, or null if anything goes
 *  wrong: artwork is decoration, so a failure must never break metadata. */
async function toDataUrl(src: string): Promise<string | null> {
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Guards against a slow read for a track the user has already skipped past. */
let artToken = 0;

/** Capacitor (Android app) backend — the web <audio> pipeline unchanged, plus
 *  the native media-session plugin mirroring metadata / playback state /
 *  position and receiving the notification's transport commands. On Android
 *  the plugin runs a foreground service while state is 'playing', which is
 *  what keeps audio alive across app-switch / screen-off. */
export const createCapacitorBackend: CreateAudioBackend = (events) => {
  let duration = 0;
  let position = 0;
  let lastPosPush = 0;

  // The notification seekbar only moves when positionState is pushed; ~1s
  // matches the web timeupdate cadence without spamming the bridge.
  const pushPosition = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPosPush < 1000) return;
    lastPosPush = now;
    const p = plugin();
    if (!p || !duration || !isFinite(duration)) return;
    call(p.setPositionState({ duration, position, playbackRate: 1 }));
  };

  const wrapped: AudioBackendEvents = {
    ...events,
    onTime: (sec) => {
      position = sec;
      events.onTime(sec);
      pushPosition();
    },
    onDuration: (d) => {
      duration = d;
      events.onDuration(d);
      pushPosition(true);
    },
    onPlay: () => {
      events.onPlay();
      call(plugin()?.setPlaybackState({ playbackState: 'playing' }));
    },
    onPause: () => {
      events.onPause();
      call(plugin()?.setPlaybackState({ playbackState: 'paused' }));
    },
  };

  const web = createWebBackend(wrapped);

  return {
    ...web,

    setMetadata(track: Track | null, localArtSrc?: string | null) {
      web.setMetadata(track, localArtSrc);
      const p = plugin();
      if (!p) return;
      if (!track) {
        // 'none' releases the session → Android drops the notification and
        // stops the foreground service.
        call(p.setPlaybackState({ playbackState: 'none' }));
        return;
      }
      // Local art (a downloaded copy's own file, converted to a
      // _capacitor_file_ URL by the caller) wins over the remote artworkUrl:
      // the lock screen should show it even with the radio off.
      const art = localArtSrc ?? track.artworkUrl;
      const base = {
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: track.album ?? '',
      };
      call(p.setMetadata({ ...base, artwork: art ? [{ src: art, sizes: '512x512' }] : [] }));

      // A _capacitor_file_ URL only resolves inside the WebView: the plugin
      // fetches artwork natively (HttpURLConnection), so that URL gives the
      // lock screen no bitmap at all. Re-read the file here, where it does
      // resolve, and hand the plugin a data: URL it can decode offline.
      if (!localArtSrc || !isLocalFileSrc(localArtSrc)) return;
      const token = ++artToken;
      void toDataUrl(localArtSrc).then((dataUrl) => {
        // A later track already claimed the session: dropping a stale read
        // matters more than showing it, or the lock screen ends up one track
        // behind on fast skips.
        if (!dataUrl || token !== artToken) return;
        call(p.setMetadata({ ...base, artwork: [{ src: dataUrl, sizes: '512x512' }] }));
      });
    },

    setRemoteCommands(cmds: RemoteCommands) {
      web.setRemoteCommands(cmds);
      const p = plugin();
      if (!p) return;
      call(p.setActionHandler({ action: 'play' }, () => cmds.play()));
      call(p.setActionHandler({ action: 'pause' }, () => cmds.pause()));
      call(p.setActionHandler({ action: 'nexttrack' }, () => cmds.next()));
      call(p.setActionHandler({ action: 'previoustrack' }, () => cmds.prev()));
      call(p.setActionHandler({ action: 'seekto' }, (d) => {
        if (typeof d?.seekTime === 'number') cmds.seek(d.seekTime);
      }));
    },

    destroy() {
      const p = plugin();
      if (p) {
        call(p.setPlaybackState({ playbackState: 'none' }));
        (['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'] as const).forEach((action) =>
          call(p.setActionHandler({ action }, null)),
        );
      }
      web.destroy();
    },
  };
};
