/** Which QR sign-in, if any, was this browser's own. The new device knows
 *  its request id (it polled with it), so when its session arrives it notes
 *  the id here, and Settings > Devices can keep that sign-in out of "Other
 *  devices". Display only: nothing is decided on it, and a browser with no
 *  storage (private window, blocked site data) just shows it as another. */

const KEY = 'ember-qr-signin';
const ID_RE = /^[a-z0-9]{15}$/;

export function rememberQrSignIn(id: string): void {
  if (!ID_RE.test(id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // No storage: the row stays under Other devices.
  }
}

export function rememberedQrSignIn(): string | null {
  try {
    const id = localStorage.getItem(KEY);
    return id && ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}
