import type { CastRemote } from '@/lib/playback/castBackend';

/** Where a Google Cast session meets the player. The Cast controller
 *  (lib/cast/controller) reports sessions starting and ending; the
 *  PlayerProvider listens, and swaps its engine for a cast one and back.
 *  A session that started before the player was listening (the SDK joining
 *  a running session on page load) is handed over when it starts to. */
export interface CastSessionListener {
  start(remote: CastRemote, deviceName: string, opts: { resumed: boolean }): void;
  end(): void;
}

let listener: CastSessionListener | null = null;
let active: { remote: CastRemote; deviceName: string; resumed: boolean } | null = null;

export function setCastSessionListener(l: CastSessionListener): () => void {
  listener = l;
  if (active) l.start(active.remote, active.deviceName, { resumed: active.resumed });
  return () => {
    if (listener === l) listener = null;
  };
}

export function castSessionStarted(remote: CastRemote, deviceName: string, resumed = false): void {
  active = { remote, deviceName, resumed };
  listener?.start(remote, deviceName, { resumed });
}

export function castSessionEnded(): void {
  if (!active) return;
  active = null;
  listener?.end();
}

/** Tests only. */
export function _resetCastSession(): void {
  listener = null;
  active = null;
}
