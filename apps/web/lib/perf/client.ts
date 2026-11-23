'use client';

import { logger } from '@/lib/logger/client';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { detectShell } from '@/lib/playback/detectShell';
import { isSignedIn, maybeAutoPerfReport } from '@/lib/autoReport';
import { pagePerf } from './index';
import { buildDigest } from './digest';
import { applyHostAnswer, configChecked, markConfigChecked, onPerfSwitch, sessionOff } from './switch';

/** Boots the page perf log (docs/android-performance.md, 5.2 and 5.5) and
 *  delivers it: every signed-in member's page sends a small digest (at most
 *  2 KB) to POST /api/perf-log every 5 min while it is open and when it is
 *  hidden (sendBeacon), at most 14 an hour, for an admin to read back
 *  (npm run perf). A very slow launch, navigation or freeze also files an
 *  automatic perf report. Uploads follow the "automatic reports" setting;
 *  the host can switch it all off. */

export const PERF_ENDPOINT = '/api/perf-log';
export const UPLOAD_EVERY_MS = 5 * 60 * 1000;
export const MAX_UPLOADS_PER_HOUR = 14;
/** Automatic perf report thresholds (section 5.5). */
export const REPORT_LAUNCH_MS = 15_000;
export const REPORT_NAV_MS = 8_000;
export const REPORT_FREEZE_MS = 5_000;
/** The host is asked for its perf settings this long after hydrating, so
 *  the question never competes with the launch. */
const CONFIG_DELAY_MS = 5000;
const SENT_KEY = 'ember.perf.sent';

let booted = false;
let uploadTimer: ReturnType<typeof setInterval> | null = null;
let launchSent = false;
const cleanups: (() => void)[] = [];

/** Upload times of the last hour, kept per device (localStorage). */
function recentUploads(now: number): number[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((t): t is number => typeof t === 'number' && now - t < 3_600_000) : [];
  } catch {
    return [];
  }
}

function noteUpload(now: number): void {
  try {
    window.localStorage.setItem(SENT_KEY, JSON.stringify([...recentUploads(now), now]));
  } catch {
    // Unrecorded: the hourly budget is then per page load.
  }
}

function uploadsAllowed(): boolean {
  return pagePerf.on && useSettingsStore.getState().autoReportEnabled && isSignedIn();
}

/** Sends one digest if there is something to say and the budget allows.
 *  `beacon` for a page being hidden: no answer is read then. */
export async function flushDigest(beacon: boolean): Promise<void> {
  try {
    if (!uploadsAllowed()) return;
    const now = Date.now();
    if (recentUploads(now).length >= MAX_UPLOADS_PER_HOUR) return;
    const digest = buildDigest(pagePerf, {
      session: logger.sessionId,
      app: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',
      shell: detectShell(),
      withLaunch: !launchSent && pagePerf.launchReady(),
    });
    if (!digest) return;
    if (digest.launch) launchSent = true;
    noteUpload(now);
    const body = JSON.stringify(digest);
    if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(PERF_ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    const res = await fetch(PERF_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body,
    });
    applyHostAnswer(await res.json().catch(() => null));
  } catch {
    // A lost digest is fine; the next one carries on.
  }
}

/** Asks the host once per session whether perf logging is on. */
async function checkConfig(): Promise<void> {
  if (configChecked() || !pagePerf.on || !isSignedIn()) return;
  try {
    const res = await fetch(PERF_ENDPOINT, { credentials: 'include' });
    if (!res.ok) return;
    markConfigChecked();
    applyHostAnswer(await res.json().catch(() => null), { roll: true });
  } catch {
    // Unreachable host: ask again on the next page load.
  }
}

function startUploadTimer(): void {
  if (uploadTimer || !pagePerf.on) return;
  uploadTimer = setInterval(() => void flushDigest(false), UPLOAD_EVERY_MS);
}

function stopUploadTimer(): void {
  if (uploadTimer) clearInterval(uploadTimer);
  uploadTimer = null;
}

/** LoggerInit calls this after logger.boot(), once hydrated. */
export function bootPerf(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  const off = sessionOff();
  if (off) {
    pagePerf.stop(off);
    return;
  }

  pagePerf.start();
  pagePerf.setPlaying(() => usePlayerStore.getState().isPlaying);
  pagePerf.setSize('queue', () => usePlayerStore.getState().queue.length);
  pagePerf.setSize('logs', () => logger.ringSize());
  cleanups.push(logger.onRoute((path, from, how) => pagePerf.onRoute(path, from, how)));

  cleanups.push(
    pagePerf.onEvent((e) => {
      if (e.kind === 'hide') {
        stopUploadTimer();
        void flushDigest(true);
      } else if (e.kind === 'launch' && e.ms > REPORT_LAUNCH_MS) {
        maybeAutoPerfReport('launch', `slow launch: ${(e.ms / 1000).toFixed(1)} s until the page answered`);
      } else if (e.kind === 'nav' && !e.rec.abandoned && (e.rec.total ?? 0) > REPORT_NAV_MS) {
        maybeAutoPerfReport('nav', `slow navigation to ${e.rec.to}: ${((e.rec.total ?? 0) / 1000).toFixed(1)} s`);
      } else if (e.kind === 'freeze' && e.rec.gapMs > REPORT_FREEZE_MS) {
        maybeAutoPerfReport('freeze', `page froze for ${(e.rec.gapMs / 1000).toFixed(1)} s`);
      }
    }),
  );

  const onVisibility = () => {
    if (document.visibilityState === 'visible') startUploadTimer();
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
  if (document.visibilityState !== 'hidden') startUploadTimer();

  cleanups.push(onPerfSwitch((on, reason) => {
    if (!on) shutdown(reason ?? 'host');
  }));

  pagePerf.markHydrated();
  const configTimer = setTimeout(() => void checkConfig(), CONFIG_DELAY_MS);
  cleanups.push(() => clearTimeout(configTimer));
}

/** The kill switch, page side: every observer, timer and listener goes. */
function shutdown(reason: string): void {
  stopUploadTimer();
  pagePerf.stop(reason);
  for (const c of cleanups.splice(0)) c();
}

/** Tests only. */
export function _resetPerfClient(): void {
  booted = false;
  launchSent = false;
  stopUploadTimer();
  for (const c of cleanups.splice(0)) c();
}
