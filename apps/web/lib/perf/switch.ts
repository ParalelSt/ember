/** The page side of the perf kill switch (section 5.6). The host says off
 *  through /api/perf-log; the page then stops for the rest of the session
 *  (sessionStorage, so a reload in the same tab stays off) and tells its
 *  listeners. The phone app will listen here to stop its own perf log
 *  (native slice 4). */

const OFF_KEY = 'ember.perf.off';
const CONFIG_KEY = 'ember.perf.cfg';

export type OffReason = 'host' | 'sample';

const listeners = new Set<(on: boolean, reason?: OffReason) => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Why perf logging is off for this session, or null when it is on. */
export function sessionOff(): OffReason | null {
  const v = storage()?.getItem(OFF_KEY);
  return v === 'host' || v === 'sample' ? v : null;
}

export function switchOff(reason: OffReason): void {
  try {
    storage()?.setItem(OFF_KEY, reason);
  } catch {
    // Quota or disabled: off for this page load only.
  }
  for (const fn of listeners) {
    try {
      fn(false, reason);
    } catch {
      // A listener never stops the others.
    }
  }
}

/** Hears the switch going off. Returns the unsubscribe. */
export function onPerfSwitch(fn: (on: boolean, reason?: OffReason) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True once this session asked the host for its perf settings. */
export function configChecked(): boolean {
  return storage()?.getItem(CONFIG_KEY) === '1';
}

export function markConfigChecked(): void {
  try {
    storage()?.setItem(CONFIG_KEY, '1');
  } catch {
    // Asked again next page load: harmless.
  }
}

/** The host's answer (GET or POST /api/perf-log) applied: `{ off: true }`
 *  switches off. With `roll` (the session's first answer only), a `sample`
 *  under 1 keeps that share of sessions; rolled on every upload it would
 *  sooner or later switch everyone off. */
export function applyHostAnswer(answer: unknown, { roll = false, random = Math.random } = {}): void {
  if (!answer || typeof answer !== 'object') return;
  const a = answer as { off?: unknown; sample?: unknown };
  if (a.off === true) {
    switchOff('host');
    return;
  }
  if (roll && typeof a.sample === 'number' && a.sample >= 0 && a.sample < 1 && random() >= a.sample) switchOff('sample');
}
