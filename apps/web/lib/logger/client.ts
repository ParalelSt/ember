'use client';

import { usePlayerStore } from '@/stores/usePlayerStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { detectShell } from '@/lib/playback/detectShell';
import type { ClientSnapshot, LogEntry, LogKind, LogLevel, ReportContext } from './types';
import { scrub } from './sanitize';

// lib/ stays framework-free (no React/Next imports — see eslint.config.mjs),
// but the zustand stores are plain JS modules with a getState() escape hatch,
// so reading them here (rather than pushing context up through
// setContextProvider) keeps the context envelope in one place. backendKind
// has no store of its own (it is a PlayerProvider ref), so that one field
// comes in through setContext() instead.
const RING_MAX = 400;
const STORAGE_KEY = 'ember.logs.last';
const STORAGE_MAX_BYTES = 256 * 1024; // ~256 KB
const CONSOLE_DEDUPE_MS = 1000;

class ClientLogger {
  private current: LogEntry[] = [];
  private previous: LogEntry[] = [];
  readonly sessionId: string = uuid();
  private booted = false;
  /** Fields no store owns (currently just backendKind). Merged into every
   *  snapshot's context. */
  private contextOverrides: Partial<ReportContext> = {};
  /** Last navigator.storage.estimate() result — refreshed best-effort on
   *  boot; estimate() is async so snapshot() stays synchronous by reading
   *  this cached value instead of awaiting. */
  private storageEstimate: { usage: number; quota: number } | undefined;
  /** category:message -> ts of the last time it was recorded, for the
   *  console.error/warn 1 s dedupe. */
  private consoleSeen = new Map<string, number>();
  private lastRoute = '';

  /** Idempotent. Hydrates `previous` from localStorage, registers global error
   *  handlers, a pagehide flush, and the automatic breadcrumb hooks (console,
   *  clicks, route changes). Safe to call multiple times. */
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

    this.installConsoleBreadcrumbs();
    this.installClickBreadcrumbs();
    this.installRouteBreadcrumbs();
    this.refreshStorageEstimate();
  }

  /** Fields the store layer has no home for (only backendKind today). Merged
   *  into the context envelope on every snapshot(). */
  setContext(partial: Partial<ReportContext>): void {
    this.contextOverrides = { ...this.contextOverrides, ...partial };
  }

  private installConsoleBreadcrumbs(): void {
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.error = (...args: unknown[]) => {
      origError(...args);
      this.recordConsole('error', args);
    };
    console.warn = (...args: unknown[]) => {
      origWarn(...args);
      this.recordConsole('warn', args);
    };
  }

  private recordConsole(level: 'error' | 'warn', args: unknown[]): void {
    const message = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
    const key = `${level}:${message}`;
    const now = Date.now();
    const last = this.consoleSeen.get(key);
    if (last !== undefined && now - last < CONSOLE_DEDUPE_MS) return;
    this.consoleSeen.set(key, now);
    this.breadcrumb('console', message, { level });
  }

  /** Bubble-phase click listener: only reports elements deliberately labelled
   *  for accessibility (closest aria-labelled button/link), and only the
   *  label + route — never text content, which could carry user data. */
  private installClickBreadcrumbs(): void {
    document.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      const el = target?.closest('button[aria-label], a[aria-label]');
      const label = el?.getAttribute('aria-label');
      if (!label) return;
      this.breadcrumb('ui', 'click', { label, route: window.location.pathname });
    }, { capture: true });
  }

  /** SPA route changes: Next's router (and any other pushState navigation)
   *  goes through history.pushState, back/forward through popstate. Records
   *  the initial route too, so this is the one place route breadcrumbs come
   *  from (nothing else should call breadcrumb('route', ...)). */
  private installRouteBreadcrumbs(): void {
    this.lastRoute = window.location.pathname;
    this.breadcrumb('route', this.lastRoute);

    const recordIfChanged = () => {
      const path = window.location.pathname;
      if (path === this.lastRoute) return;
      this.lastRoute = path;
      this.breadcrumb('route', path);
    };
    window.addEventListener('popstate', recordIfChanged);

    const origPushState = history.pushState.bind(history);
    history.pushState = ((...args: Parameters<History['pushState']>) => {
      origPushState(...args);
      recordIfChanged();
    }) as History['pushState'];
  }

  private refreshStorageEstimate(): void {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
    navigator.storage.estimate()
      .then((est) => {
        this.storageEstimate = { usage: est.usage ?? 0, quota: est.quota ?? 0 };
      })
      .catch(() => {
        // Unsupported / denied — context envelope just omits it.
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

  /** Snapshot of current ring + previous-session archive, plus a context
   *  envelope of what the app was doing, scrubbed and ready for submission. */
  snapshot(): ClientSnapshot {
    return {
      current: scrub(this.current) as LogEntry[],
      previous: scrub(this.previous) as LogEntry[],
      sessionId: this.sessionId,
      context: scrub(this.buildContext()) as ReportContext,
    };
  }

  /** Built at call time, not cached, so a snapshot always reflects the
   *  moment it was taken. SSR-safe: returns a minimal/inert envelope when
   *  called with no window (context.setContext overrides still apply). */
  private buildContext(): ReportContext {
    if (typeof window === 'undefined') {
      return {
        appVersion: readAppVersion(),
        shell: 'web',
        platform: '',
        language: '',
        online: true,
        route: '',
        viewport: { w: 0, h: 0 },
        track: null,
        queue: { index: -1, length: 0 },
        backendKind: null,
        isPlaying: false,
        loopMode: 'off',
        shuffle: false,
        offlinePins: 0,
        ...this.contextOverrides,
      };
    }

    const player = usePlayerStore.getState();
    const offline = useOfflineStore.getState();
    const track = player.queue[player.index] ?? null;

    return {
      appVersion: readAppVersion(),
      shell: detectShell(),
      platform: navigator.platform ?? '',
      language: navigator.language ?? '',
      online: navigator.onLine,
      route: window.location.pathname,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      track: track ? { id: track.id, source: track.source, title: track.title } : null,
      queue: { index: player.index, length: player.queue.length },
      backendKind: null,
      isPlaying: player.isPlaying,
      loopMode: player.loopMode,
      shuffle: player.shuffle,
      offlinePins: offline.downloaded.length,
      storageEstimate: this.storageEstimate,
      ...this.contextOverrides,
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

function readAppVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown';
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
