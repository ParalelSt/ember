import {
  appCheckDue,
  appUpdateWaitsForTap,
  checkForAppUpdate,
  getAppUpdateState,
  installAppUpdateWithResume,
  openInstallSettings,
  takeAppResumeNote,
  type AppUpdateState,
} from '@/lib/appUpdate';
import { detectShell } from '@/lib/playback/detectShell';
import { sanitizeVersion } from '@/lib/versions/label';
import { loadDeviceInfo } from '@/lib/versions/device';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { logger } from '@/lib/logger/client';
import { findUpdates, newer, pickOffer, type UpdateOffer } from './check';

/** Checking for, and bringing in, a newer Ember (lib/update/check.ts says
 *  what is newer). A tap updates NOW, even while a song plays (owner,
 *  2026-11-24: waiting for the song to end never arrived when the player
 *  moved on without the page seeing it, e.g. repeat-one or the Android
 *  app's own player):
 *
 *   - The song playing and its position are noted down (`ember.update.resume`;
 *     the Android and desktop apps keep their own copy through the install)
 *     and start again by themselves once the page is back
 *     (`takeUpdateResume`, read by the player before it loads anything).
 *   - A web build reloads the page; the desktop and Android apps download
 *     the new version and install it.
 *   - Offline: it waits ("Updating once back online"); a reload with no host
 *     would leave a blank page. It goes ahead when the host answers again.
 *
 *  Updates stay optional: nothing here runs without a tap. */

const RESUME_KEY = 'ember.update.resume';
/** A resume note older than this is from some other day: ignored. An app
 *  install can take a while (a download, an installer, a tap on "Ember
 *  updated" to come back). */
export const RESUME_FRESH_MS = 10 * 60 * 1000;
export interface ResumeTarget {
  index: number;
  trackId: string;
  /** Where in the song it was (seconds); absent = from its beginning. */
  positionSec?: number;
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export interface ApplyDeps {
  reload: () => void;
  installDesktop: (resume: string | null) => Promise<boolean>;
  installAndroid: (resume: string | null) => Promise<boolean>;
  openInstallSettings: () => Promise<boolean>;
}

async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

/** The desktop app installs (and ends): resolves false only when the update
 *  could not even start (no update, a failed download or signature). */
async function installDesktopViaTauri(resume: string | null): Promise<boolean> {
  try {
    await tauriInvoke('update_install', { resume });
    return true;
  } catch {
    return false;
  }
}

/** The desktop app's copy of the resume note, once (null in any other app,
 *  or a desktop app from before 0.4.27). */
async function takeDesktopResumeNote(): Promise<string | null> {
  if (detectShell() !== 'tauri') return null;
  try {
    const note = await tauriInvoke('update_take_resume');
    return typeof note === 'string' ? note : null;
  } catch {
    return null;
  }
}

/** Loads the page again past any cache: a WebView can keep serving the old
 *  build for a plain reload, so the address carries a fresh query value. */
function cacheBustingReload(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_ember_r', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

const defaultDeps: ApplyDeps = {
  reload: cacheBustingReload,
  installDesktop: installDesktopViaTauri,
  installAndroid: installAppUpdateWithResume,
  openInstallSettings,
};
let deps: ApplyDeps = defaultDeps;
/** Test seam: what "reload", "install" and "download" do. */
export function setApplyDepsForTests(d: Partial<ApplyDeps> | null): void {
  deps = d ? { ...defaultDeps, ...d } : defaultDeps;
}

function resumeNote(target: ResumeTarget, now: number): string {
  return JSON.stringify({ ...target, at: now });
}

function writeResume(target: ResumeTarget, now: number): void {
  try {
    localStorage.setItem(RESUME_KEY, resumeNote(target, now));
  } catch {
    // No storage: the page comes back paused on that song instead.
  }
}

function clearResume(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The song to start once the page is back from an update, if one was noted
 *  just now for this very queue. Read once (it is cleared), by the player,
 *  before it loads anything. */
export function takeUpdateResume(queue: readonly { id: string }[], now: number = Date.now()): ResumeTarget | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RESUME_KEY);
    if (raw !== null) localStorage.removeItem(RESUME_KEY);
  } catch {
    return null;
  }
  return readResumeNote(raw, queue, now);
}

/** The Android app's copy of the note (kept by the app through the install,
 *  see installAppUpdateWithResume), once. */
export async function takeAppUpdateResume(queue: readonly { id: string }[], now: number = Date.now()): Promise<ResumeTarget | null> {
  const note = (await takeAppResumeNote()) ?? (await takeDesktopResumeNote());
  return readResumeNote(note, queue, now);
}

function readResumeNote(raw: string | null, queue: readonly { id: string }[], now: number): ResumeTarget | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as { index?: unknown; trackId?: unknown; at?: unknown };
    if (typeof m.index !== 'number' || typeof m.trackId !== 'string' || typeof m.at !== 'number') return null;
    if (m.at > now || now - m.at > RESUME_FRESH_MS) return null;
    if (queue[m.index]?.id !== m.trackId) return null;
    const pos = (m as { positionSec?: unknown }).positionSec;
    return {
      index: m.index,
      trackId: m.trackId,
      ...(typeof pos === 'number' && Number.isFinite(pos) && pos > 0 ? { positionSec: pos } : {}),
    };
  } catch {
    return null;
  }
}

/** Brings the offered update in now. `resume`: the song to start once back.
 *  False when it could not (the app could not download or install it). */
export async function performUpdate(resume: ResumeTarget | null = null, now: number = Date.now()): Promise<boolean> {
  const store = useUpdateStore.getState();
  const offer = store.offer;
  if (!offer?.canApply) return false;
  if (resume) writeResume(resume, now);
  store.set({ pending: false, applying: true, applyFailed: false });
  if (offer.via === 'android') {
    // Downloads first when the tap's download has not finished; the app
    // then installs it and Android replaces it.
    lastAndroidNote = resume ? resumeNote(resume, now) : null;
    if (await deps.installAndroid(lastAndroidNote)) return true;
    clearResume();
    useUpdateStore.getState().set({ applying: false, applyFailed: true });
    return false;
  }
  if (offer.via === 'desktop') {
    if (await deps.installDesktop(resume ? resumeNote(resume, now) : null)) return true;
    clearResume();
    useUpdateStore.getState().set({ applying: false, applyFailed: true });
    return false;
  }
  deps.reload();
  return true;
}

// A required web update (lib/update/required.ts) goes in without a tap. The
// guard keeps a build that stays old after reloading from reloading forever.
const FORCE_KEY = 'ember.update.force';
export const FORCE_MAX_TRIES = 2;
export const FORCE_WINDOW_MS = 10 * 60 * 1000;

let forceNeed: { running: string; required: string } | null = null;

function forceTries(now: number): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FORCE_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((t): t is number => typeof t === 'number' && now - t < FORCE_WINDOW_MS && t <= now) : [];
  } catch {
    return [];
  }
}

function noteForceTry(tries: number[], now: number): void {
  try {
    localStorage.setItem(FORCE_KEY, JSON.stringify([...tries, now]));
  } catch {
    // No storage: the page-lifetime flag below still stops a loop in one page.
  }
}

/** Reloads into the required web build now (or once the host is reachable).
 *  Never throws; after FORCE_MAX_TRIES reloads that did not bring the build
 *  in, it stops and the normal banner takes over. */
export function evaluateForce(now: number = Date.now()): void {
  const need = forceNeed;
  const store = useUpdateStore.getState();
  if (!need || store.applying) return;
  if (!newer(need.required, need.running)) {
    store.set({ forcing: false });
    return;
  }
  const tries = forceTries(now);
  if (tries.length >= FORCE_MAX_TRIES) {
    forceNeed = null;
    store.set({ forcing: false });
    logger.error('update', 'required web update did not take after reloading, falling back to the banner', {
      running: need.running,
      required: need.required,
      tries: tries.length,
    });
    return;
  }
  store.set({ forcing: true });
  // Offline: a reload with no host is a blank page; it goes on coming back.
  if (!online()) return;
  noteForceTry(tries, now);
  const resume = currentResume();
  if (resume) writeResume(resume, now);
  store.set({ applying: true, applyFailed: false });
  deps.reload();
}

/** A check found what the host requires: starts the forced update when this
 *  build is older. */
function noteRequiredWeb(running: string | null, required: string | null): void {
  const run = running ? sanitizeVersion(running) : null;
  const need = required ? sanitizeVersion(required) : null;
  useUpdateStore.getState().set({ requiredWeb: need });
  if (!run || !need || !newer(need, run)) {
    forceNeed = null;
    useUpdateStore.getState().set({ forcing: false });
    return;
  }
  forceNeed = { running: run, required: need };
  evaluateForce();
}

export type UpdateRequest = 'now' | 'waiting-online' | 'none';

/** The song playing and where it is, to start again once back from the
 *  update. Null when nothing plays: a paused song comes back paused from the
 *  player's own saved queue. */
export function currentResume(): ResumeTarget | null {
  const { isPlaying, queue, index, position } = usePlayerStore.getState();
  const track = queue[index];
  if (!isPlaying || !track) return null;
  const sec = Number.isFinite(position) && position > 0 ? Math.floor(position) : 0;
  return { index, trackId: track.id, ...(sec > 0 ? { positionSec: sec } : {}) };
}

/** The reminder's (or Settings') tap: updates now, keeping the song. */
export function requestUpdate(): UpdateRequest {
  const store = useUpdateStore.getState();
  if (!store.offer?.canApply || store.applying) return 'none';
  if (!online()) {
    store.set({ pending: true });
    return 'waiting-online';
  }
  void performUpdate(currentResume());
  return 'now';
}

/** While a tap waits for the host to answer (offline): once it is back, the
 *  update goes ahead. Returns the unsubscribe. */
export function watchPendingUpdate(): () => void {
  const evaluate = () => {
    const { pending, applying } = useUpdateStore.getState();
    if (!pending || applying || !online()) return;
    void performUpdate(currentResume());
  };
  const offUpdate = useUpdateStore.subscribe((s, prev) => {
    if (s.pending !== prev.pending) evaluate();
  });
  const onOnline = () => {
    evaluate();
    evaluateForce();
  };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  evaluate();
  evaluateForce();
  return () => {
    offUpdate();
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  };
}

let checking: Promise<void> | null = null;

/** Asks the Android app's feed too, unless the app's own answer is fresh
 *  (appCheckDue); [manual] (a tap) always asks. Never throws. */
async function askApp(manual: boolean): Promise<void> {
  try {
    if (manual || appCheckDue(await getAppUpdateState(), Date.now())) await checkForAppUpdate();
  } catch {
    /* the answer arrives as a state, or not at all */
  }
}

/** Asks the host what is newest and records the answer. One at a time;
 *  never throws. [opts.manual]: the person tapped "Check for updates". */
export function checkForUpdates(fetchImpl?: typeof fetch, opts: { manual?: boolean } = {}): Promise<void> {
  // A tap that lands during a check the app started by itself: that check
  // may have left the app's feed alone (askApp), so the tap asks it itself.
  if (opts.manual && checking) {
    const inFlight = checking;
    const ask = loadDeviceInfo().then(
      (info) => (info.platform === 'android' && appUpdateWaitsForTap() ? askApp(true) : undefined),
      () => undefined,
    );
    return Promise.all([inFlight, ask]).then(() => undefined);
  }
  checking ??= (async () => {
    const store = useUpdateStore.getState();
    store.set({ status: 'checking' });
    try {
      const info = await loadDeviceInfo();
      const android = info.platform === 'android' && appUpdateWaitsForTap();
      // The Android app asks its own feed; its answer arrives as a state
      // (noteAppUpdateState), the one before it is kept here.
      if (android) void askApp(opts.manual === true);
      const found = await findUpdates({ platform: info.platform, shell: info.shellVersion }, fetchImpl);
      if (android) found.shellLatest = useUpdateStore.getState().shellLatest;
      const offer = pickOffer(found, { web: info.webVersion, shell: info.shellVersion, platform: info.platform });
      if (!found.failed) noteRequiredWeb(info.webVersion, found.requiredWeb ?? null);
      const prev = useUpdateStore.getState().offer;
      const same = !!prev && !!offer && prev.kind === offer.kind && prev.version === offer.version;
      useUpdateStore.getState().set({
        status: found.failed ? 'failed' : offer ? 'available' : 'up-to-date',
        // A failed check keeps what an earlier one found.
        ...(found.failed
          ? {}
          : { offer: sameOffer(prev, offer) ? prev : offer, webLatest: found.webLatest, shellLatest: found.shellLatest }),
        // A different update than the one waiting: the wait was for that one.
        ...(!found.failed && !same ? { pending: false } : {}),
        checkedAt: Date.now(),
      });
    } catch {
      useUpdateStore.getState().set({ status: 'failed', checkedAt: Date.now() });
    } finally {
      checking = null;
    }
  })();
  return checking;
}

let askedPermission = false;
/** The resume note of the Android install under way, for its retry. */
let lastAndroidNote: string | null = null;

const ANDROID_HAS_UPDATE: readonly AppUpdateState['status'][] = ['available', 'downloading', 'ready', 'installing'];

/** The Android app's updater moved (a check found a newer app, a download
 *  ran): the reminder and Settings follow it. Only for an app that waits
 *  for a tap; older ones have their own pill. */
export async function noteAppUpdateState(state: AppUpdateState): Promise<void> {
  const store = useUpdateStore.getState();
  const shellLatest = ANDROID_HAS_UPDATE.includes(state.status) && state.latest
    ? state.latest
    : state.status === 'up-to-date'
      ? null
      : store.shellLatest;
  const info = await loadDeviceInfo();
  const offer = pickOffer(
    { webLatest: store.webLatest, shellLatest },
    { web: info.webVersion, shell: state.current ?? info.shellVersion, platform: info.platform },
  );
  // Android's "Install unknown apps" is off for Ember: the tap's install
  // waits on it. Its settings open once; back from them with it on, the
  // install goes ahead.
  const now = useUpdateStore.getState();
  if (now.applying && state.status === 'ready' && state.waiting === 'permission' && !askedPermission) {
    askedPermission = true;
    void deps.openInstallSettings();
  } else if (askedPermission && state.status === 'ready' && state.waiting === 'tap') {
    askedPermission = false;
    void deps.installAndroid(lastAndroidNote);
  }
  const prev = now.offer;
  useUpdateStore.getState().set({
    shellLatest,
    offer: sameOffer(prev, offer) ? prev : offer,
    ...(offer ? { status: 'available' } : {}),
    // The app could not install it (refused, failed): say so, try again on a tap.
    ...(state.status === 'failed' && useUpdateStore.getState().applying ? { applying: false, applyFailed: true } : {}),
  });
}

function sameOffer(a: UpdateOffer | null, b: UpdateOffer | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.version === b.version && a.via === b.via && a.canApply === b.canApply;
}

/** Test seam. */
export function resetUpdateForTests(): void {
  checking = null;
  askedPermission = false;
  lastAndroidNote = null;
  forceNeed = null;
  deps = defaultDeps;
  clearResume();
  try {
    localStorage.removeItem(FORCE_KEY);
  } catch {
    /* nothing */
  }
}
