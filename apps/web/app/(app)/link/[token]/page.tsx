'use client';

import { use } from 'react';
import { ApproveLinkView } from '@/components/auth/ApproveLinkView';

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
export default function ApproveLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <ApproveLinkView token={safeDecode(token)} />;
}
