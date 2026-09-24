/** Device conditions the prefetch policy gates on, read from the browser.
 *
 *  `online` follows lib/useOnline's rules (event driven and optimistic at
 *  load): navigator.onLine reads false for the first moments of a page load
 *  even on a fine network, so it is only believed after SETTLE_MS, or when an
 *  `offline` event says so. */

export interface Conditions {
  online: boolean;
  /** null = unknown, which the policy treats as not metered. */
  metered: boolean | null;
  saveData: boolean;
  /** Always false on the web: the Battery Status API reports charge, not
   *  the OS power saver, and is gone from most browsers anyway. Android
   *  reads the real thing natively (PowerManager.isPowerSaveMode). */
  batterySaver: boolean;
}

const SETTLE_MS = 2000;

interface NetworkInformationLike extends EventTarget {
  type?: string;
  saveData?: boolean;
}

function connection(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection ?? null;
}

/** `cellular` is the only type that reliably means paid-for data; wifi,
 *  ethernet and the rest are not, and a browser that hides the type (most
 *  desktop ones) gives no answer. */
export function readMetered(): boolean | null {
  const type = connection()?.type;
  if (!type || type === 'unknown') return null;
  return type === 'cellular';
}

export function readSaveData(): boolean {
  return connection()?.saveData === true;
}

/** Watches the browser's connectivity and calls `onChange` with fresh
 *  conditions on every change (online/offline, a network type switch, the
 *  settle check). Returns the stop function. */
export function watchConditions(onChange: (c: Conditions) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let online = true;
  const emit = () => onChange({ online, metered: readMetered(), saveData: readSaveData(), batterySaver: false });
  const goOnline = () => { online = true; emit(); };
  const goOffline = () => { online = false; emit(); };
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  const conn = connection();
  conn?.addEventListener?.('change', emit);
  const settle = setTimeout(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false && online) goOffline();
  }, SETTLE_MS);
  emit();
  return () => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
    conn?.removeEventListener?.('change', emit);
    clearTimeout(settle);
  };
}
