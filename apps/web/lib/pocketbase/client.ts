'use client';

import PocketBase from 'pocketbase';

// Defaults to the same-origin `/pb` proxy (see next.config.ts rewrites) so the
// browser only ever talks to one origin — works locally and behind a single
// static tunnel URL without per-restart edits.
const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? '/pb';

/** Browser PocketBase client. Hydrates auth from document.cookie on creation
 *  and writes back to it on every auth change so the server route handlers
 *  see the same session via the `pb_auth` cookie. */
export function createClient() {
  const pb = new PocketBase(PB_URL);
  if (typeof document !== 'undefined') {
    pb.authStore.loadFromCookie(document.cookie);
    pb.authStore.onChange(() => {
      document.cookie = pb.authStore.exportToCookie({
        httpOnly: false,
        secure: false,
        sameSite: 'lax',
      });
    }, false);
  }
  return pb;
}
