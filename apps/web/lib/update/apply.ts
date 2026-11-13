import { loadDeviceInfo } from '@/lib/versions/device';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { findUpdates, pickOffer } from './check';

/** Checking for, and bringing in, a newer Ember (lib/update/check.ts says
 *  what is newer). Nothing here ever interrupts a song:
 *
 *   - Nothing playing: a tap updates at once (the page reloads, or the
 *     desktop app restarts, and its launch dialog installs the new one).
 *   - A song playing: the update waits for the song to end
 *     ("Updating after this song"). The player calls `updateAtSongEnd` in
 *     the gap before the next song; the next song is noted down
 *     (`ember.update.resume`) and starts by itself once the page is back
 *     (`takeUpdateResume`, read by the player before it loads anything).
 *   - Paused while waiting: nothing is playing any more, so it goes ahead.
 *   - Offline: it waits; a reload with no host would leave a blank page.
 *   - The music plays somewhere else (the Android app's own player, another
 *     device this one controls): the page reloading cannot stop it, so it
 *     goes ahead at once. */

const RESUME_KEY = 'ember.update.resume';
/** A resume note older than this is from some other day: ignored. A desktop
 *  app restart goes through the launch dialog's countdown and installer. */
export const RESUME_FRESH_MS = 10 * 60 * 1000;
/** Paused this long while an update waits: nothing is playing, go ahead. A
 *  moment's pause between two songs must not count. */
export const PAUSED_GRACE_MS = 2000;

export interface ResumeTarget {
  index: number;
  trackId: string;
}

let elsewhere: () => boolean = () => false;
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
  restartShell: () => Promise<boolean>;
}

async function restartShellViaTauri(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('update_restart');
    return true;
  } catch {
    return false;
  }
}

const defaultDeps: ApplyDeps = {
  reload: () => window.location.reload(),
  restartShell: restartShellViaTauri,
};
let deps: ApplyDeps = defaultDeps;
/** Test seam: what "reload" and "restart" do. */
export function setApplyDepsForTests(d: Partial<ApplyDeps> | null): void {
  deps = d ? { ...defaultDeps, ...d } : defaultDeps;
}

function writeResume(target: ResumeTarget, now: number): void {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ ...target, at: now }));
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
 *  False when it could not (the desktop app could not restart itself). */
export async function performUpdate(resume: ResumeTarget | null = null, now: number = Date.now()): Promise<boolean> {
  const store = useUpdateStore.getState();
  const offer = store.offer;
  if (!offer?.canApply) return false;
  if (resume) writeResume(resume, now);
  store.set({ pending: false, applying: true, applyFailed: false });
  if (offer.kind === 'shell') {
    if (await deps.restartShell()) return true;
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
  if (!usePlayerStore.getState().isPlaying || elsewhere()) {
    void performUpdate(null);
    return 'now';
  }
  store.set({ pending: true });
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
    if (usePlayerStore.getState().isPlaying && !elsewhere()) return;
    timer = setTimeout(() => {
      const s = useUpdateStore.getState();
      if (!s.pending || s.applying || !online()) return;
      if (usePlayerStore.getState().isPlaying && !elsewhere()) return;
      void performUpdate(null);
    }, PAUSED_GRACE_MS);
  };
  const offPlayer = usePlayerStore.subscribe((s, prev) => {
    if (s.isPlaying !== prev.isPlaying) evaluate();
  });
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
      const found = await findUpdates({ platform: info.platform, shell: info.shellVersion }, fetchImpl);
      const offer = pickOffer(found, { web: info.webVersion, shell: info.shellVersion });
      const prev = useUpdateStore.getState().offer;
      const same = !!prev && !!offer && prev.kind === offer.kind && prev.version === offer.version;
      useUpdateStore.getState().set({
        status: found.failed ? 'failed' : offer ? 'available' : 'up-to-date',
        // A failed check keeps what an earlier one found.
        ...(found.failed ? {} : { offer, webLatest: found.webLatest, shellLatest: found.shellLatest }),
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

/** Test seam. */
export function resetUpdateForTests(): void {
  checking = null;
  elsewhere = () => false;
  deps = defaultDeps;
  clearResume();
}
