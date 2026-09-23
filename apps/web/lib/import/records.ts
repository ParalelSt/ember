/** PocketBase rows of `import_jobs` and `import_items` (pocketbase/pb_hooks/
 *  ensure_imports.pb.js) to what the API and the runner hand around, and
 *  back. Pure, so the mapping is unit tested without a server. */

import type { Track } from '@/types/track';
import type { ImportCandidate, ImportItem, ImportJob, ImportSourceKind, JobKind, SourceItem } from '@/lib/import/types';
import type { ItemStatus, JobStatus } from '@/lib/import/jobState';
import { GOOGLE_LIKES_SOURCE_ID, notMusicCount } from '@/lib/import/musicCheck';

type Row = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** PocketBase's own date format, which its filters compare as text. */
export function pbDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ');
}

/** A PocketBase date back to epoch ms, or null when the field is empty. */
export function pbMillis(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const ms = new Date(s.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function jobFromRecord(r: Row): ImportJob {
  const retryAt = str(r.retry_at);
  const counts = { cursor: num(r.cursor), accepted: num(r.accepted), review: num(r.review), missing: num(r.missing) };
  return {
    id: str(r.id),
    userId: str(r.user),
    kind: (str(r.kind) || 'playlist') as JobKind,
    playlistId: str(r.playlist) || null,
    name: str(r.name),
    source: (str(r.source) || 'spotify') as ImportSourceKind,
    sourceUrl: str(r.source_url),
    coverUrl: str(r.cover_url) || null,
    status: (str(r.status) || 'queued') as JobStatus,
    total: num(r.total),
    cursor: num(r.cursor),
    accepted: num(r.accepted),
    review: num(r.review),
    missing: num(r.missing),
    existing: num(r.existing),
    error: str(r.error) || null,
    retryAt: retryAt ? new Date(retryAt.replace(' ', 'T')).toISOString() : null,
    dismissed: r.dismissed === true,
    ...(str(r.source_id) === GOOGLE_LIKES_SOURCE_ID ? { notMusic: notMusicCount(counts) } : {}),
  };
}

function isCandidate(c: unknown): c is ImportCandidate {
  const t = (c as { track?: Track } | null)?.track;
  return !!t && typeof t.id === 'string' && typeof t.sourceId === 'string';
}

export function itemFromRecord(r: Row): ImportItem {
  const artists = Array.isArray(r.source_artists) ? r.source_artists.filter((a): a is string => typeof a === 'string') : [];
  const position = num(r.position);
  const source: SourceItem = {
    position,
    title: str(r.source_title),
    artists,
    artist: artists.join(', '),
    durationMs: num(r.source_duration_ms) || null,
    explicit: typeof r.source_explicit === 'boolean' ? r.source_explicit : null,
    uri: str(r.source_uri) || null,
  };
  const confidence = typeof r.confidence === 'number' && r.status !== 'pending' ? r.confidence : null;
  return {
    id: str(r.id),
    position,
    status: (str(r.status) || 'pending') as ItemStatus,
    source,
    likedAt: pbMillis(r.liked_at),
    videoId: str(r.video_id) || null,
    confidence,
    candidates: Array.isArray(r.candidates) ? r.candidates.filter(isCandidate) : [],
  };
}

/** The row for a new pending item. `candidates` is filled in advance only
 *  for a YouTube Music playlist, whose tracks need no search; `likedAt` only
 *  for a transfer, where it decides where the song lands in the likes. */
export function itemRecord(
  jobId: string,
  item: SourceItem,
  candidates: ImportCandidate[] = [],
  likedAt: number | null = null,
): Row {
  return {
    job: jobId,
    position: item.position,
    liked_at: likedAt === null ? '' : pbDate(likedAt),
    source_title: item.title,
    source_artists: item.artists,
    source_duration_ms: item.durationMs ?? 0,
    source_explicit: item.explicit,
    source_uri: item.uri ?? '',
    status: 'pending',
    video_id: '',
    confidence: 0,
    candidates,
  };
}

/** A YouTube Music playlist track as a source item plus its one ready
 *  candidate: the playlist named the exact video, so there is nothing to
 *  guess. `reason` is what the review sheet shows for that candidate; a
 *  transfer from someone's own likes says so instead. */
export function readyItem(
  track: Track,
  position: number,
  reason = 'From the playlist itself',
): { item: SourceItem; candidates: ImportCandidate[] } {
  return {
    item: {
      position,
      title: track.title,
      artists: track.artist ? [track.artist] : [],
      artist: track.artist ?? '',
      durationMs: track.durationSec ? track.durationSec * 1000 : null,
      explicit: null,
      uri: null,
    },
    candidates: [
      {
        track,
        artists: track.artist ? [track.artist] : [],
        videoType: null,
        explicit: null,
        score: 100,
        reasons: [reason],
      },
    ],
  };
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** A track a person picked in the review sheet, checked and rebuilt from
 *  its known fields: only a YouTube video can stand in for a source song. */
export function cleanPickedTrack(raw: unknown): Track | null {
  const t = raw as Partial<Track> | null;
  if (!t || typeof t !== 'object') return null;
  const sourceId = typeof t.sourceId === 'string' ? t.sourceId : '';
  if (t.source !== 'youtube' || !VIDEO_ID_RE.test(sourceId) || t.id !== `youtube:${sourceId}`) return null;
  const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
  const title = text(t.title);
  if (!title) return null;
  return {
    id: t.id,
    source: 'youtube',
    sourceId,
    title,
    artist: text(t.artist),
    artistId: text(t.artistId, 60) || null,
    album: text(t.album) || null,
    albumId: text(t.albumId, 60) || null,
    durationSec: typeof t.durationSec === 'number' && t.durationSec > 0 ? Math.round(t.durationSec) : 0,
    artworkUrl: /^https:\/\//.test(text(t.artworkUrl, 500)) ? text(t.artworkUrl, 500) : null,
    streamUrl: `/api/youtube/stream/${sourceId}`,
  };
}
