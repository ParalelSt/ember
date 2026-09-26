'use client';

import { apiUrl } from '@/lib/api';
import type { CastMedia } from '@/lib/playback/castBackend';
import type { Track } from '@/types/track';
import type { CastItem, CastSignResponse } from './types';

/** A signed link is reused while it has this long left; a song is never
 *  handed to the TV on a link that could die before it ends. */
const REUSE_MARGIN_SEC = 60 * 60;

const cache = new Map<string, { item: CastItem; origin: string; expiresAt: number }>();

/** Tests only. */
export function _clearCastSignCache(): void {
  cache.clear();
}

/** What the TV gets for [track]: the signed stream, its content type, and
 *  title, artist, album and a cover the device can load by itself (an
 *  upload's cover signed, a relative one on the host's public origin, a
 *  YouTube one as it is). Pure: the signing is done by the caller. */
export function castMediaFor(track: Track, item: CastItem, origin: string): CastMedia {
  let artworkUrl = item.artworkUrl;
  if (!artworkUrl && track.source !== 'upload' && track.artworkUrl) {
    const a = track.artworkUrl;
    if (/^https?:\/\//i.test(a)) artworkUrl = a;
    else if (a.startsWith('//')) artworkUrl = `https:${a}`;
    else if (a.startsWith('/')) artworkUrl = `${origin.replace(/\/+$/, '')}${a}`;
  }
  return {
    url: item.streamUrl,
    contentType: item.contentType,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artworkUrl,
  };
}

/** Signed links for [ids] from the host (POST /api/cast/sign), reusing any
 *  still fresh. */
export async function signCastItems(ids: string[], nowSec = Date.now() / 1000): Promise<Map<string, { item: CastItem; origin: string }>> {
  const out = new Map<string, { item: CastItem; origin: string }>();
  const missing: string[] = [];
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && hit.expiresAt - nowSec > REUSE_MARGIN_SEC) out.set(id, hit);
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  const res = await fetch(apiUrl('/api/cast/sign'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: missing }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'sign in to cast' : `could not sign cast links (${res.status})`);
  const body = (await res.json()) as CastSignResponse;
  for (const [id, item] of Object.entries(body.items ?? {})) {
    const entry = { item, origin: body.origin, expiresAt: body.expiresAt };
    cache.set(id, entry);
    out.set(id, entry);
  }
  return out;
}

/** The CastMedia for one track, signing it (and the next few, so a skip
 *  does not wait on the host) when needed. */
export async function resolveCastMedia(track: Track, upcoming: Track[] = []): Promise<CastMedia> {
  const ids = [track.id, ...upcoming.map((t) => t.id).filter((id) => id !== track.id)].slice(0, 5);
  const signed = await signCastItems(ids);
  const hit = signed.get(track.id);
  if (!hit) throw new Error('this song cannot be cast');
  return castMediaFor(track, hit.item, hit.origin);
}
