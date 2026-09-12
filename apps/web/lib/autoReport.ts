'use client';

import { logger } from './logger/client';
import type { LogEntry } from './logger/types';
import { fingerprint } from './reports/fingerprint';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore } from '@/stores/useUiStore';
import { readDesktopLog } from './desktopLog';
import { scrubText } from './logger/sanitize';

/** Silent crash reports: when the client logger records an error-level
 *  entry, post the same body BugReportDialog would send (tagged
 *  `automatic: true`) without asking, so hosts learn about crashes nobody
 *  bothered to report by hand. Every gate here fails closed — signed out,
 *  the Settings toggle off, the manual dialog open, this fingerprint already
 *  reported, or the per-session cap reached all just mean "don't send",
 *  never a thrown error back into the logger call that triggered us. */

const STORAGE_KEY = 'ember.autoReport.session';
const MAX_PER_SESSION = 3;
const DEBOUNCE_MS = 2000;

interface SessionState {
  /** Fingerprints already reported this session — one automatic report per
   *  fingerprint, ever, for the life of the sessionStorage entry. */
  reported: string[];
  /** Total automatic reports sent this session, independent of how many
   *  distinct fingerprints that covers. */
  count: number;
}

/** In-memory only, keyed by fingerprint: coalesces a burst of the same error
 *  firing repeatedly within DEBOUNCE_MS into a single report. Cleared on
 *  reload (fresh module instance), which is fine — a fresh page load's first
 *  occurrence of a fingerprint still debounces its own burst. */
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function readSession(): SessionState {
  if (typeof window === 'undefined') return { reported: [], count: 0 };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { reported: [], count: 0 };
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return {
      reported: Array.isArray(parsed.reported) ? parsed.reported.filter((f) => typeof f === 'string') : [],
      count: typeof parsed.count === 'number' ? parsed.count : 0,
    };
  } catch {
    // Corrupt / disabled storage: behave as a fresh session rather than
    // refusing to ever auto-report.
    return { reported: [], count: 0 };
  }
}

function writeSession(state: SessionState): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / disabled storage: the cap degrades to in-memory-only for this
    // call. Worst case a couple of extra reports this session, not a bug.
  }
}

/** Claims a slot for `fp` before the debounced send actually fires, so two
 *  different fingerprints racing each other can't both slip past the
 *  session cap. Returns false (and writes nothing) when `fp` was already
 *  reported this session or the cap is already reached. */
function reserve(fp: string): boolean {
  const state = readSession();
  if (state.reported.includes(fp) || state.count >= MAX_PER_SESSION) return false;
  state.reported.push(fp);
  state.count += 1;
  writeSession(state);
  return true;
}

/** Same source of truth the rest of the app uses: PocketBase's browser
 *  client mirrors its auth state into this cookie (see
 *  lib/pocketbase/client.ts), and the server route requires it too. Reading
 *  the cookie directly here avoids depending on a PocketBase client
 *  instance existing in every place an error can originate. */
function isSignedIn(): boolean {
  if (typeof document === 'undefined') return false;
  const m = /(?:^|;\s*)pb_auth=([^;]*)/.exec(document.cookie);
  return !!m && decodeURIComponent(m[1]).length > 0;
}

async function send(entry: LogEntry): Promise<void> {
  try {
    const snapshot = logger.snapshot();
    // Desktop only, best effort — same as BugReportDialog's submit.
    const desktopLog = await readDesktopLog();
    if (desktopLog) snapshot.desktopLog = scrubText(desktopLog);
    const res = await fetch('/api/bug-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        note: `${entry.category}: ${entry.message}`,
        client: snapshot,
        automatic: true,
      }),
    });
    if (!res.ok) {
      logger.breadcrumb('autoReport', `automatic report failed: ${res.status}`);
    }
  } catch (e) {
    logger.breadcrumb('autoReport', 'automatic report failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Called by the client logger right after recording an error-level entry
 *  (uncaught error, unhandled rejection, backend playback error, native
 *  offline error — anything that goes through logger.error()). */
export function maybeAutoReport(entry: LogEntry): void {
  try {
    if (typeof window === 'undefined') return;
    if (entry.kind !== 'error' || entry.level !== 'error') return;
    if (!useSettingsStore.getState().autoReportEnabled) return;
    if (!isSignedIn()) return;
    if (useUiStore.getState().bugReportOpen) return;

    const fp = fingerprint(entry);
    if (pendingTimers.has(fp)) return; // burst: already debounced

    const state = readSession();
    if (state.reported.includes(fp) || state.count >= MAX_PER_SESSION) return;

    const timer = setTimeout(() => {
      pendingTimers.delete(fp);
      // Re-check everything at fire time: the debounce window is 2s, plenty
      // of time for the toggle to flip, the dialog to open, or another
      // fingerprint to fill the cap. reserve() below is the actual
      // race-safe cap check; these are just cheap early exits.
      if (!useSettingsStore.getState().autoReportEnabled) return;
      if (!isSignedIn()) return;
      if (useUiStore.getState().bugReportOpen) return;
      if (!reserve(fp)) return;
      void send(entry);
    }, DEBOUNCE_MS);
    pendingTimers.set(fp, timer);
  } catch (e) {
    logger.breadcrumb('autoReport', 'maybeAutoReport internal failure', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
