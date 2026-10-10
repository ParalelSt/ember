'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApproveSheet } from '@/components/auth/ApproveSheet';
import { justApprovedFrom } from '@/components/auth/ApproveSheetHost';
import { PageTitle } from '@/components/page/PageTitle';
import { DEVICES_PATH } from '@/hooks/useQrScan';
import { LINK_TOKEN_RE } from '@/lib/qrLogin/codes';
import { useUiStore } from '@/stores/useUiStore';

/** /link/<token> (a phone camera opened the QR while signed in) and /link
 *  (token stashed by proxy.ts across a sign-in): the approve sheet over a
 *  quiet page. The token leaves the address bar as soon as it is read; it
 *  is single use and lives 3 minutes anyway. This entry is a dead end once
 *  the sheet is done, so closing REPLACES it with Home, and approving with
 *  Settings > Devices, where the new device is lit up. */
export function ApproveLinkView({ token }: { token: string | null }) {
  // Read once: the credential stays in state after the URL is scrubbed.
  const [credential] = useState(() => (token && LINK_TOKEN_RE.test(token) ? { token } : null));
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const setJustApproved = useUiStore((s) => s.setJustApproved);

  useEffect(() => {
    if (window.location.pathname !== '/link') window.history.replaceState(null, '', '/link');
  }, []);

  return (
    <section className="max-w-lg">
      <PageTitle className="mb-stack">Sign in a device</PageTitle>
      {credential ? (
        <>
          <p className="text-sm text-muted-foreground">A device is asking to sign in to your account.</p>
          {open && (
            <ApproveSheet
              credential={credential}
              onClose={() => {
                setOpen(false);
                router.replace('/');
              }}
              onApproved={(facts) => {
                setOpen(false);
                setJustApproved(justApprovedFrom(facts));
                router.replace(DEVICES_PATH);
              }}
            />
          )}
        </>
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
