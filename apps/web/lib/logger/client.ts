'use client';

import type { ClientSnapshot, LogEntry, LogKind, LogLevel } from './types';
import { scrub } from './sanitize';

const RING_MAX = 200;
const STORAGE_KEY = 'ember.logs.last';
const STORAGE_MAX_BYTES = 256 * 1024; // ~256 KB

class ClientLogger {
  private current: LogEntry[] = [];
  private previous: LogEntry[] = [];
  readonly sessionId: string = uuid();
  private booted = false;

  /** Idempotent. Hydrates `previous` from localStorage, registers global error
   *  handlers and a pagehide flush. Safe to call multiple times. */
  boot(): void {
    if (this.booted || typeof window === 'undefined') return;
    this.booted = true;

    // Hydrate previous-session archive.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) this.previous = JSON.parse(raw) as LogEntry[];
    } catch {
      // Corrupt / quota / disabled storage — start empty.
      this.previous = [];
    }

    // Global JS exceptions.
    window.addEventListener('error', (e) => {
      this.error('js', e.message || 'window error', { filename: e.filename, lineno: e.lineno, colno: e.colno }, e.error);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason;
      const msg = reason instanceof Error ? reason.message : String(reason ?? 'unhandled rejection');
      const err = reason instanceof Error ? reason : undefined;
      this.error('js', msg, { reason: safeJson(reason) }, err);
    });

    // Flush ring buffer to localStorage on tab hide / close.
    window.addEventListener('pagehide', () => this.flush());
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  error(category: string, message: string, data?: unknown, err?: Error | unknown): void {
    try {
      this.push('error', 'error', category, message, data, err);
    } catch (e) {
      console.warn('[logger.error] internal failure', e);
    }
  }

  breadcrumb(category: string, message: string, data?: unknown): void {
    try {
      this.push('breadcrumb', 'info', category, message, data);
    } catch (e) {
      console.warn('[logger.breadcrumb] internal failure', e);
    }
  }

  /** Snapshot of current ring + previous-session archive, scrubbed and ready
   *  for submission. */
  snapshot(): ClientSnapshot {
    return {
      current: scrub(this.current) as LogEntry[],
      previous: scrub(this.previous) as LogEntry[],
      sessionId: this.sessionId,
    };
  }

  private push(
    kind: LogKind,
    level: LogLevel,
    category: string,
    message: string,
    data?: unknown,
    err?: Error | unknown,
  ): void {
    const entry: LogEntry = {
      ts: Date.now(),
      kind,
      level,
      category,
      message,
      sessionId: this.sessionId,
    };
    if (data !== undefined) entry.data = data;
    if (err instanceof Error && err.stack) entry.stack = err.stack;

    this.current.push(entry);
    // Drop oldest if over the cap.
    if (this.current.length > RING_MAX) {
      this.current.splice(0, this.current.length - RING_MAX);
    }
  }

  private flush(): void {
    if (typeof window === 'undefined') return;
    try {
      let payload = JSON.stringify(this.current);
      // If oversized, drop oldest half and retry once.
      if (payload.length > STORAGE_MAX_BYTES) {
        const half = Math.floor(this.current.length / 2);
        const trimmed = this.current.slice(half);
        payload = JSON.stringify(trimmed);
      }
      window.localStorage.setItem(STORAGE_KEY, payload);
    } catch {
      // Quota / disabled — skip silently. Current session still works.
    }
  }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older environments.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/** Module-level singleton — multiple imports share the same buffer. */
export const logger = new ClientLogger();
