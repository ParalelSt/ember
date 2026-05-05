const BASE = 'https://api.jamendo.com/v3.0';

function clientId() {
  const id = process.env.JAMENDO_CLIENT_ID;
  if (!id) throw new Error('JAMENDO_CLIENT_ID not set');
  return id;
}

function normalize(t) {
  return {
    id: `jamendo:${t.id}`,
    sourceId: String(t.id),
    source: 'jamendo',
    title: t.name,
    artist: t.artist_name,
    album: t.album_name,
    durationSec: t.duration,
    artworkUrl: t.album_image || t.image,
    streamUrl: t.audio,
    downloadAllowed: Boolean(t.audiodownload_allowed),
  };
}

export async function searchTracks(query, { limit = 30, offset = 0 } = {}) {
  const url = new URL(`${BASE}/tracks`);
  url.search = new URLSearchParams({
    client_id: clientId(),
    format: 'json',
    limit: String(limit),
    offset: String(offset),
    search: query,
    include: 'musicinfo',
    audioformat: 'mp32',
  }).toString();
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error('Jamendo search failed'), { status: 502 });
  const data = await r.json();
  return (data.results ?? []).map(normalize);
}

export async function getTrack(sourceId) {
  const url = new URL(`${BASE}/tracks`);
  url.search = new URLSearchParams({
    client_id: clientId(),
    format: 'json',
    id: sourceId,
    audioformat: 'mp32',
  }).toString();
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error('Jamendo lookup failed'), { status: 502 });
  const data = await r.json();
  const t = (data.results ?? [])[0];
  return t ? normalize(t) : null;
}

export async function featured({ limit = 30 } = {}) {
  const url = new URL(`${BASE}/tracks`);
  url.search = new URLSearchParams({
    client_id: clientId(),
    format: 'json',
    limit: String(limit),
    order: 'popularity_total',
    audioformat: 'mp32',
  }).toString();
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error('Jamendo featured failed'), { status: 502 });
  const data = await r.json();
  return (data.results ?? []).map(normalize);
}
