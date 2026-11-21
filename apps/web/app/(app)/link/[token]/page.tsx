'use client';

import { use } from 'react';
import { ApproveLinkView } from '@/components/auth/ApproveLinkView';
import dynamic from 'next/dynamic';
import { uiSwitch } from '@/components/providers/uiSwitch';

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}

/** The QR on a new device's sign-in page opens this (plan 1b), when the
 *  phone is already signed in. Signed out, proxy.ts keeps the token in a
 *  short httpOnly cookie and sends the phone to /auth?next=/link instead. */
function NewApproveLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <ApproveLinkView token={safeDecode(token)} />;
}

/** The Classic look's page (RULES.md "Classic look"), loaded only on a
 *  device that chose it. */
const LegacyApproveLinkPage = dynamic(() => import('@legacy/app/link/[token]/page'));

export default uiSwitch(NewApproveLinkPage, LegacyApproveLinkPage);
