import {
  appUpdateWaitsForTap,
  checkForAppUpdate,
  downloadAppUpdate,
  installAppUpdateWithResume,
  openInstallSettings,
  takeAppResumeNote,
  type AppUpdateState,
} from '@/lib/appUpdate';
import { detectShell } from '@/lib/playback/detectShell';
import { loadDeviceInfo } from '@/lib/versions/device';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { findUpdates, pickOffer, type UpdateOffer } from './check';

/** Checking for, and bringing in, a newer Ember (lib/update/check.ts says
 *  what is newer). Nothing here ever interrupts a song:
 *
 *   - Nothing playing: a tap updates at once (the page reloads, or the
 *     desktop or Android app downloads the new version and installs it).
 *   - A song playing: the update waits for the song to end
 *     ("Updating after this song"). The player calls `updateAtSongEnd` in
 *     the gap before the next song; the next song is noted down
 *     (`ember.update.resume`) and starts by itself once the page is back
 *     (`takeUpdateResume`, read by the player before it loads anything).
 *   - Paused while waiting: nothing is playing any more, so it goes ahead.
 *   - Offline: it waits; a reload with no host would leave a blank page.
 *   - The music plays somewhere else (the Android app's own player, another
 *     device this one controls): the page reloading cannot stop it, so a
 *     web build goes in at once.
 *   - The Android app itself (from 0.4.34 it waits for this tap): installing
 *     replaces the app and stops its player, so it waits for the song like
 *     anything else. The page never sees that song end (the app's own
 *     player moves on by itself), so the next song showing up is the
 *     moment: it is paused at once and the install starts, and that song
 *     starts again once the new app is open. The download starts at the
 *     tap, so the gap stays short.
 *   - The desktop app itself (from 0.4.27): the page plays through the app's
 *     engine and sees the song end, so it goes in at `updateAtSongEnd` like
 *     a web build. The download starts at the tap (`update_download`), the
 *     install at the end of the song (`update_install`, which ends the app:
 *     the resume note goes with it, `update_take_resume` hands it back). */

const RESUME_KEY = 'ember.update.resume';
/** A resume note older than this is from some other day: ignored. An app
 *  install can take a while (a download, an installer, a tap on "Ember
 *  updated" to come back). */
export const RESUME_FRESH_MS = 10 * 60 * 1000;
/** Paused this long while an update waits: nothing is playing, go ahead. A
 *  moment's pause between two songs must not count. */
export const PAUSED_GRACE_MS = 2000;

export interface ResumeTarget {
  index: number;
  trackId: string;
}

let elsewhere: () => boolean = () => false;
let pauseForUpdate: () => void = () => {};
/** The player's pause, for the Android app's install between songs. */
export function setUpdatePause(fn: (() => void) | null): void {
  pauseForUpdate = fn ?? (() => {});
}
/** The player says whether the music is played by something the page's
 *  reload cannot stop. */
export function setPlaybackElsewhereProbe(fn: (() => boolean) | null): void {
  elsewhere = fn ?? (() => false);
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export interface ApplyDeps {
  reload: () => void;
  installDesktop: (resume: string | null) => Promise<boolean>;
  downloadDesktop: () => Promise<boolean>;
  installAndroid: (resume: string | null) => Promise<boolean>;
  downloadAndroid: () => Promise<boolean>;
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

async function downloadDesktopViaTauri(): Promise<boolean> {
  try {
    await tauriInvoke('update_download');
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

const defaultDeps: ApplyDeps = {
  reload: () => window.location.reload(),
  installDesktop: installDesktopViaTauri,
  downloadDesktop: downloadDesktopViaTauri,
  installAndroid: installAppUpdateWithResume,
  downloadAndroid: downloadAppUpdate,
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
    return { index: m.index, trackId: m.trackId };
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

export type UpdateRequest = 'now' | 'after-song' | 'waiting-online' | 'none';

/** The reminder's (or Settings') tap. */
export function requestUpdate(): UpdateRequest {
  const store = useUpdateStore.getState();
  if (!store.offer?.canApply || store.applying) return 'none';
  if (!online()) {
    store.set({ pending: true });
    return 'waiting-online';
  }
  const offer = store.offer;
  if (!usePlayerStore.getState().isPlaying || (offer.via === 'reload' && elsewhere())) {
    void performUpdate(null);
    return 'now';
  }
  store.set({ pending: true });
  // Fetched now, installed at the end of the song.
  if (offer.via === 'android') void deps.downloadAndroid();
  if (offer.via === 'desktop') void deps.downloadDesktop();
  return 'after-song';
}

/** The player, in the gap after a song ended on its own and before the next
 *  one loads. True when an update was waiting and is now going in: the
 *  player then loads nothing. `next`: the song that would have come next. */
export function updateAtSongEnd(next: ResumeTarget | null): boolean {
  const store = useUpdateStore.getState();
  if (!store.pending || !store.offer?.canApply || store.applying || !online()) return false;
  void performUpdate(next);
  return true;
}

/** While an update waits: once nothing plays (paused for PAUSED_GRACE_MS)
 *  and the host is reachable, it goes ahead. Returns the unsubscribe. */
export function watchPendingUpdate(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const evaluate = () => {
    clearTimeout(timer);
    timer = undefined;
    const { pending, applying } = useUpdateStore.getState();
    if (!pending || applying) return;
    const goesNow = () => {
      const o = useUpdateStore.getState().offer;
      return !usePlayerStore.getState().isPlaying || (o?.via === 'reload' && elsewhere());
    };
    if (!goesNow()) return;
    timer = setTimeout(() => {
      const s = useUpdateStore.getState();
      if (!s.pending || s.applying || !online()) return;
      if (!goesNow()) return;
      void performUpdate(null);
    }, PAUSED_GRACE_MS);
  };
  const offPlayer = usePlayerStore.subscribe((s, prev) => {
    if (s.isPlaying !== prev.isPlaying) evaluate();
    // A song the page does not see end (the Android app's own player, a
    // device this one controls): the next one showing up is the gap.
    const now = s.queue[s.index];
    const before = prev.queue[prev.index];
    if (now && before && now.id !== before.id && s.isPlaying) songChanged({ index: s.index, trackId: now.id });
  });
  const songChanged = (next: ResumeTarget) => {
    const { pending, applying, offer } = useUpdateStore.getState();
    if (!pending || applying || !offer?.canApply || !online()) return;
    if (offer.via === 'android' || elsewhere()) {
      pauseForUpdate();
      void performUpdate(next);
    }
  };
  const offUpdate = useUpdateStore.subscribe((s, prev) => {
    if (s.pending !== prev.pending) evaluate();
  });
  const onOnline = () => evaluate();
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  evaluate();
  return () => {
    clearTimeout(timer);
    offPlayer();
    offUpdate();
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  };
}

let checking: Promise<void> | null = null;

/** Asks the host what is newest and records the answer. One at a time;
 *  never throws. */
export function checkForUpdates(fetchImpl?: typeof fetch): Promise<void> {
  checking ??= (async () => {
    const store = useUpdateStore.getState();
    store.set({ status: 'checking' });
    try {
      const info = await loadDeviceInfo();
      const android = info.platform === 'android' && appUpdateWaitsForTap();
      // The Android app asks its own feed; its answer arrives as a state
      // (noteAppUpdateState), the one before it is kept here.
      if (android) void checkForAppUpdate();
      const found = await findUpdates({ platform: info.platform, shell: info.shellVersion }, fetchImpl);
      if (android) found.shellLatest = useUpdateStore.getState().shellLatest;
      const offer = pickOffer(found, { web: info.webVersion, shell: info.shellVersion, platform: info.platform });
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
  elsewhere = () => false;
  pauseForUpdate = () => {};
  askedPermission = false;
  lastAndroidNote = null;
  deps = defaultDeps;
  clearResume();
}
