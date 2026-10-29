/** "The saved queue was the last account's and has been dropped" (sign-out,
 *  another account signing in on this device). AuthProvider says it;
 *  PlayerProvider listens and empties the native Android player too, which
 *  keeps its own queue: without that the old account's songs stayed on the
 *  lock screen and in the car, played on, and native recorded those plays
 *  under the new account's cookie. Framework-free, like lib/sessionExpired. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onAccountPlaybackCleared(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function accountPlaybackCleared(): void {
  for (const fn of listeners) fn();
}
