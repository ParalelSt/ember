'use client';

import { logger } from '@/lib/logger/client';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { detectShell } from '@/lib/playback/detectShell';
import { isSignedIn } from '@/lib/autoReport';
import { pagePerf } from './index';
import { buildDigest } from './digest';
import { pageOs } from './os';
import { applyHostAnswer, configChecked, markConfigChecked, onPerfSwitch, sessionOff } from './switch';

/** Boots the page perf log (docs/android-performance.md, 5.2 and 5.5) and
 *  delivers it per session, in batches: every signed-in person's page sends
 *  what happened since its last batch (at most 6 KB, numbered from 1) to
 *  POST /api/perf-log every 5 min while it is open, and when it is left or
 *  closed (sendBeacon), at most 20 an hour. The host keeps each batch as it
 *  comes, so a session that ends abruptly still has the ones before, and an
 *  admin reads a session back merged in order (npm run perf). Nothing is
 *  reported on the spot. Only the host can switch it off. */

export const PERF_ENDPOINT = '/api/perf-log';
export const UPLOAD_EVERY_MS = 5 * 60 * 1000;
/** The session's first batch goes this soon after opening, so even a short
 *  visit is heard from well inside the first 5 minutes. */
export const FIRST_UPLOAD_MS = 60 * 1000;
export const MAX_UPLOADS_PER_HOUR = 20;
/** The host is asked for its perf settings this long after hydrating, so
 *  the question never competes with the launch. */
const CONFIG_DELAY_MS = 5000;
const SENT_KEY = 'ember.perf.sent';
/** How often an open page asks the host again, so a long-lived app (the
 *  phone's WebView can stay up for days) hears the kill switch too. */
export const CONFIG_EVERY_MS = 30 * 60 * 1000;

let booted = false;
let uploadTimer: ReturnType<typeof setInterval> | null = null;
let configTimer: ReturnType<typeof setInterval> | null = null;
let firstUploadTimer: ReturnType<typeof setTimeout> | null = null;
let lastConfigCheck = 0;
let launchSent = false;
/** The last batch number this page load sent. */
let seq = 0;
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

/** Everyone signed in sends (the route takes members only); the host's
 *  kill switch and sample share are the only way off. */
function uploadsAllowed(): boolean {
  return pagePerf.on && isSignedIn();
}

function timeOrigin(): number {
  const t = typeof performance !== 'undefined' ? performance.timeOrigin : undefined;
  return typeof t === 'number' && t > 0 ? t : Date.now() - (typeof performance !== 'undefined' ? performance.now() : 0);
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
      seq: seq + 1,
      t0: timeOrigin(),
      app: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',
      shell: detectShell(),
      os: pageOs(),
      withLaunch: !launchSent && pagePerf.launchReady(),
    });
    if (!digest) return;
    seq = digest.seq;
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

/** Asks the host whether perf logging is on: on every page load and every
 *  30 min while open, whether or not this page may upload (the kill switch
 *  must reach a page that never sends a digest, and a beacon's answer is
 *  never read). The sample share is rolled on the session's first answer. */
export async function checkConfig(): Promise<void> {
  if (!pagePerf.on) return;
  lastConfigCheck = Date.now();
  try {
    const res = await fetch(PERF_ENDPOINT, { credentials: 'include' });
    if (!res.ok) return;
    const first = !configChecked();
    markConfigChecked();
    applyHostAnswer(await res.json().catch(() => null), { roll: first });
  } catch {
    // Unreachable host: asked again on the next round.
  }
}

/** The upload and config timers, only while the page is visible. */
function startTimers(): void {
  if (!pagePerf.on) return;
  if (!uploadTimer) uploadTimer = setInterval(() => void flushDigest(false), UPLOAD_EVERY_MS);
  if (seq === 0 && !firstUploadTimer) {
    firstUploadTimer = setTimeout(() => {
      firstUploadTimer = null;
      void flushDigest(false);
    }, FIRST_UPLOAD_MS);
  }
  if (!configTimer) configTimer = setInterval(() => void checkConfig(), CONFIG_EVERY_MS);
}

function stopTimers(): void {
  if (uploadTimer) clearInterval(uploadTimer);
  if (configTimer) clearInterval(configTimer);
  uploadTimer = null;
  configTimer = null;
  if (firstUploadTimer) clearTimeout(firstUploadTimer);
  firstUploadTimer = null;
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
      // Left or closed: send what has not gone yet.
      if (e.kind === 'hide') {
        stopTimers();
        void flushDigest(true);
      }
    }),
  );

  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    startTimers();
    // Back from the background after a long time: ask straight away.
    if (lastConfigCheck && Date.now() - lastConfigCheck >= CONFIG_EVERY_MS) void checkConfig();
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
  if (document.visibilityState !== 'hidden') startTimers();

  cleanups.push(onPerfSwitch((on, reason) => {
    if (!on) shutdown(reason ?? 'host');
  }));

  pagePerf.markHydrated();
  const firstCheck = setTimeout(() => void checkConfig(), CONFIG_DELAY_MS);
  cleanups.push(() => clearTimeout(firstCheck));
}

/** The kill switch, page side: every observer, timer and listener goes. */
function shutdown(reason: string): void {
  stopTimers();
  pagePerf.stop(reason);
  for (const c of cleanups.splice(0)) c();
}

/** Tests only. */
export function _resetPerfClient(): void {
  booted = false;
  launchSent = false;
  seq = 0;
  lastConfigCheck = 0;
  stopTimers();
  for (const c of cleanups.splice(0)) c();
}
