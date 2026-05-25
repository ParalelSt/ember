import type { NextRequest } from 'next/server';
import { updateDiscordActivity, clearDiscordActivity } from '@/lib/discord';
import type { Track } from '@/types/track';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { track?: Track | null; isPlaying?: boolean } | null;
  if (body?.track && body.isPlaying) updateDiscordActivity(body.track, true);
  else clearDiscordActivity();
  return Response.json({ ok: true });
}
