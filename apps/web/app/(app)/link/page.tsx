import { cookies } from 'next/headers';
import { ApproveLinkView } from '@/components/auth/ApproveLinkView';
// A plain module: a value imported from a 'use client' file is only a
// client reference on the server.
import { LINK_COOKIE, LINK_TOKEN_RE } from '@/lib/qrLogin/codes';

/** Where a phone lands after signing in to approve a QR sign-in (plan 1b):
 *  proxy.ts kept the approve token in the httpOnly ember_link cookie (Path
 *  /link, 5 minutes) instead of the URL; the lookup route clears it once the
 *  card has used it. */
export default async function ApproveStashedLinkPage() {
  const raw = (await cookies()).get(LINK_COOKIE)?.value ?? '';
  return <ApproveLinkView token={LINK_TOKEN_RE.test(raw) ? raw : null} />;
}
