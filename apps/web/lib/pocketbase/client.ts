'use client';

import PocketBase from 'pocketbase';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? 'http://127.0.0.1:8090';

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
