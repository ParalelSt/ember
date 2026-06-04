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

/** What the client sends in a bug report. */
export interface ClientSnapshot {
  current: LogEntry[];
  previous: LogEntry[];
  sessionId: string;
}
