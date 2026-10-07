'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApproveSignIn } from '@/components/auth/ApproveSignIn';
import { PageTitle } from '@/components/page/PageTitle';

export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** The approve page's body, for /link/<token> (signed in when the QR was
 *  scanned) and /link (token stashed by proxy.ts across a sign-in). The
 *  token leaves the address bar as soon as it is read; it is single use and
 *  lives 3 minutes anyway. */
export function ApproveLinkView({ token }: { token: string | null }) {
  // Read once: the credential stays in state after the URL is scrubbed.
  const [credential] = useState(() => (token && LINK_TOKEN_RE.test(token) ? { token } : null));

  useEffect(() => {
    if (window.location.pathname !== '/link') window.history.replaceState(null, '', '/link');
  }, []);

  return (
    <section className="max-w-lg">
      <PageTitle className="mb-stack">Sign in a device</PageTitle>
      {credential ? (
        <ApproveSignIn credential={credential} />
      ) : (
        <div className="rounded-2xl bg-card p-page shadow-soft">
          <div className="font-semibold">That link has no sign-in request in it.</div>
          <Link href="/settings/devices" className="mt-cluster inline-block text-sm text-muted-foreground underline hover:text-foreground">
            Have a code? Type it in Settings &gt; Devices
          </Link>
        </div>
      )}
    </section>
  );
}
