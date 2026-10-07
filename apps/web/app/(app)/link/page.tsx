import { cookies } from 'next/headers';
import { ApproveLinkView, LINK_TOKEN_RE } from '@/components/auth/ApproveLinkView';

/** Where a phone lands after signing in to approve a QR sign-in (plan 1b):
 *  proxy.ts kept the approve token in the httpOnly ember_link cookie (Path
 *  /link, 5 minutes) instead of the URL, and clears it with this response. */
export default async function ApproveStashedLinkPage() {
  const raw = (await cookies()).get('ember_link')?.value ?? '';
  return <ApproveLinkView token={LINK_TOKEN_RE.test(raw) ? raw : null} />;
}
