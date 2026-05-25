import 'server-only';
import type { Track } from '@/types/track';

const BASE = 'https://api.jamendo.com/v3.0';

function clientId(): string {
  const id = process.env.JAMENDO_CLIENT_ID;
  if (!id) throw new Error('JAMENDO_CLIENT_ID not set');
  return id;
}

interface JamendoTrack {
  id: number | string;
  name: string;
  artist_name: string;
  album_name: string | null;
  duration: number;
  album_image?: string;
  image?: string;
  audio: string;
  audiodownload_allowed?: boolean;
}

function normalize(t: JamendoTrack): Track {
  return {
    id: `jamendo:${t.id}`,
    sourceId: String(t.id),
    source: 'jamendo',
    title: t.name,
    artist: t.artist_name,
    artistId: null,
    album: t.album_name,
    albumId: null,
    durationSec: t.duration,
    artworkUrl: t.album_image || t.image || null,
    streamUrl: t.audio,
  };
}

async function callJamendo(params: Record<string, string>, errMsg: string): Promise<JamendoTrack[]> {
  const url = new URL(`${BASE}/tracks`);
  url.search = new URLSearchParams({
    client_id: clientId(),
    format: 'json',
    audioformat: 'mp32',
    ...params,
  }).toString();
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const err = new Error(errMsg) as Error & { status?: number };
    err.status = 502;
    throw err;
  }
  const data = (await r.json()) as { results?: JamendoTrack[] };
  return data.results ?? [];
}

export async function searchTracks(query: string, { limit = 30, offset = 0 } = {}): Promise<Track[]> {
  const results = await callJamendo(
    { limit: String(limit), offset: String(offset), search: query, include: 'musicinfo' },
    'Jamendo search failed',
  );
  return results.map(normalize);
}

export async function getTrack(sourceId: string): Promise<Track | null> {
  const results = await callJamendo({ id: sourceId }, 'Jamendo lookup failed');
  const t = results[0];
  return t ? normalize(t) : null;
}

export async function featured({ limit = 30 } = {}): Promise<Track[]> {
  const results = await callJamendo(
    { limit: String(limit), order: 'popularity_total' },
    'Jamendo featured failed',
  );
  return results.map(normalize);
}
