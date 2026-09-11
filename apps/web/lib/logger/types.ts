/** Shared types for the bug-report logging system. See
 *  docs/superpowers/specs/2026-06-04-bug-report-logging-design.md. */

export type LogKind = 'error' | 'breadcrumb';
export type LogLevel = 'error' | 'info';

export interface LogEntry {
  /** Milliseconds since epoch. */
  ts: number;
  kind: LogKind;
  level: LogLevel;
  /** Coarse bucket: 'api' | 'audio' | 'route' | 'playback' | 'auth' | 'library' | 'js' | 'react' | 'middleware' | 'python'. */
  category: string;
  message: string;
  /** Optional structured extras (route, status, trackId, …). Scrubbed before submit. */
  data?: unknown;
  /** Stack trace string; errors only. */
  stack?: string;
  /** UUID generated at client boot — lets us group entries by session. */
  sessionId: string;
}

export interface ServerLogEntry extends LogEntry {
  side: 'server';
  reqId: string;
  route: string;
  userId?: string;
}

/** Minimal track identity carried in the context envelope — never the whole
 *  Track object, so no stream URLs / artwork noise leak into a bug report. */
export interface ContextTrack {
  id: string;
  source: string;
  title: string;
}

/** Point-in-time snapshot of "what was this app doing" attached to every
 *  submitted log payload. Built at snapshot() call time from the player /
 *  offline stores plus a couple of provider-set fields (see
 *  ClientLogger.setContext) that lib/logger has no store for. */
export interface ReportContext {
  appVersion: string;
  shell: 'web' | 'capacitor' | 'tauri';
  platform: string;
  language: string;
  online: boolean;
  route: string;
  viewport: { w: number; h: number };
  track: ContextTrack | null;
  queue: { index: number; length: number };
  /** Which AudioBackend is live. Set by PlayerProvider via
   *  logger.setContext({ backendKind }) since lib/ has no ref to it. */
  backendKind: string | null;
  isPlaying: boolean;
  loopMode: string;
  shuffle: boolean;
  /** Count of playlists/tracks pinned for offline use (native pins + OPFS). */
  offlinePins: number;
  /** navigator.storage.estimate(), best effort — absent if unsupported or not
   *  yet resolved. */
  storageEstimate?: { usage: number; quota: number };
}

/** What the client sends in a bug report. */
export interface ClientSnapshot {
  current: LogEntry[];
  previous: LogEntry[];
  sessionId: string;
  context: ReportContext;
}
