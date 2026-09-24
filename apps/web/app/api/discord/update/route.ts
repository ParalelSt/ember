import type { NextRequest } from 'next/server';
import { updateDiscordActivity, clearDiscordActivity } from '@/lib/discord';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
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

/** Publish "now playing" to the OWNER's Discord (browsers can't reach their
 *  own Discord client; the desktop app talks to the local one directly).
 *
 *  One card, so only the owner's own sessions may set or clear it: any other
 *  member's call is ignored, whether they share or not, or they would take
 *  the card over or wipe it (bughunt X3). Signed-out callers get a 401.
 *
 *  Honours the owner's `share_discord` switch. The check is here as well as in
 *  the client so a stale or replayed client call can't broadcast after the
 *  switch went off. */
export const POST = withRequestLog('discord/update', async (request: NextRequest) => {
  const body = (await request.json().catch(() => null)) as
    | { track?: Track | null; isPlaying?: boolean; positionSec?: number; durationSec?: number }
    | null;

  let mayShare = false;
  try {
    // requireUser, not the cookie's record: the id must be the one
    // PocketBase vouches for, or anyone could borrow another member's switch.
    const { pb, user } = await requireUser();
    if (!isPresenceOwner(user)) return Response.json({ ok: true, shared: false, owner: false });
    const record = await pb.collection('users').getOne(user.id);
    mayShare = record.share_discord === true;
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    // PB unreachable: the switch is unknown, so leave the card as it is.
    return Response.json({ ok: true, shared: false, owner: false });
  }

  if (mayShare && body?.track && body.isPlaying) {
    updateDiscordActivity(body.track, true, Number(body.positionSec) || 0, Number(body.durationSec) || 0);
  } else clearDiscordActivity();

  return Response.json({ ok: true, shared: mayShare, owner: true });
});
