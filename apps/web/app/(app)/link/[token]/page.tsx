'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApproveSignIn } from '@/components/auth/ApproveSignIn';
import { PageTitle } from '@/components/page/PageTitle';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}

/** The QR on a new device's sign-in page opens this (plan 1b). A signed-in
 *  page: proxy.ts sends a signed-out visitor to /auth?next=/link/<token>
 *  and back. The token leaves the address bar and history as soon as it is
 *  read; it is single use and lives 3 minutes anyway. */
export default function ApproveLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = use(params);
  // Read once: the credential stays in state after the URL is scrubbed.
  const [credential] = useState(() => {
    const token = safeDecode(raw);
    return TOKEN_RE.test(token) ? { token } : null;
  });

  useEffect(() => {
    window.history.replaceState(null, '', '/link');
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
