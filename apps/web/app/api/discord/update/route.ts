import type { NextRequest } from 'next/server';
import { updateDiscordActivity, clearDiscordActivity } from '@/lib/discord';
import { createClient } from '@/lib/pocketbase/server';
import type { Track } from '@/types/track';

/** Publish "now playing" to the HOST's Discord (browsers can't reach their
 *  own Discord client; the desktop app talks to the local one directly).
 *
 *  Honours the per-user `hide_discord` switch. The check is here as well as in
 *  the client because this route drives the host's visible presence — a stale
 *  or replayed client call shouldn't be able to broadcast for someone who
 *  turned it off. Unauthenticated callers are treated as opted out: without a
 *  session there's no preference to respect. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { track?: Track | null; isPlaying?: boolean }
    | null;

  let mayShare = false;
  try {
    const pb = await createClient();
    const userId = pb.authStore.record?.id;
    if (userId) {
      const record = await pb.collection('users').getOne(userId);
      mayShare = record.hide_discord !== true;
    }
  } catch {
    // PB unreachable / no session — fall through as "don't broadcast".
  }

  if (mayShare && body?.track && body.isPlaying) updateDiscordActivity(body.track, true);
  else clearDiscordActivity();

  return Response.json({ ok: true, shared: mayShare });
}
