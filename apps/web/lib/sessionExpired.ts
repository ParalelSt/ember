'use client';

/** "Our own API says this session is gone" (a 401, bughunt V5). The API
 *  helpers call sessionExpired(); AuthProvider listens and clears its auth
 *  store, so user turns null and every signed-in fetch stops, instead of each
 *  one going on to collect its own 401. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onSessionExpired(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function sessionExpired(): void {
  // The dead cookie goes even when nothing listens: the server render reads
  // it, and a page painted from it would show a signed-in shell again.
  if (typeof document !== 'undefined') document.cookie = 'pb_auth=; Path=/; Max-Age=0; SameSite=Lax';
  for (const fn of listeners) fn();
}
