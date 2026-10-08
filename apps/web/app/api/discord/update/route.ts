import type { NextRequest } from 'next/server';
import { updateDiscordActivity, clearDiscordActivity } from '@/lib/discord';
import { requireUser } from '@/lib/auth';
import type { Track } from '@/types/track';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Is this the account whose Discord the server's card is? The server can
 *  only reach the Discord running next to it: the owner's. The owner is the
 *  EMBER_ADMIN_EMAIL account (ensure_admin.pb.js); without one configured,
 *  any admin. */
function isPresenceOwner(user: { email: string; isAdmin: boolean }): boolean {
  const owner = (process.env.EMBER_ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (owner) return user.email.trim().toLowerCase() === owner;
  return user.isAdmin;
}

/** Publish "now playing" to the HOST's Discord (browsers can't reach their
 *  own Discord client; the desktop app talks to the local one directly).
 *
 *  One card, so only the owner's own sessions may set or clear it: any other
 *  member's call is ignored, whether they share or not, or they would take
 *  the card over or wipe it (bughunt X3).
 *
 *  Honours the per-user `share_discord` switch. The check is here as well as in
 *  the client because this route drives the host's visible presence, a stale
 *  or replayed client call shouldn't be able to broadcast for someone who
 *  turned it off. A caller without a verified session changes nothing. */
export const POST = withRequestLog('discord/update', async (request: NextRequest) => {
  const body = (await request.json().catch(() => null)) as
    | { track?: Track | null; isPlaying?: boolean; positionSec?: number; durationSec?: number }
    | null;

  // requireUser, not the cookie's record: the id must be the one
  // PocketBase vouches for, or anyone could borrow another member's switch.
  let session: Awaited<ReturnType<typeof requireUser>>;
  try {
    session = await requireUser();
  } catch {
    // No verified member (signed out, or PocketBase could not say), no say
    // in the host's card: this route is public (proxy.ts), and a signed-out
    // caller used to be able to wipe whatever a member was showing. Not a
    // 401: the client treats one as "signed out" and drops its session,
    // which a PocketBase blip must never do.
    return Response.json({ ok: true, shared: false });
  }

  if (!isPresenceOwner(session.user)) return Response.json({ ok: true, shared: false, owner: false });

  let mayShare = false;
  try {
    const record = await session.pb.collection('users').getOne(session.user.id);
    mayShare = record.share_discord === true;
  } catch {
    // PB unreachable: fall through as "don't broadcast".
  }

  if (mayShare && body?.track && body.isPlaying) {
    updateDiscordActivity(body.track, true, Number(body.positionSec) || 0, Number(body.durationSec) || 0);
  } else clearDiscordActivity();

  return Response.json({ ok: true, shared: mayShare, owner: true });
});
