import 'server-only';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { Track } from '@/types/track';
import { redactSecrets } from '@/lib/import/redact';
import { serverLogger } from '@/lib/logger/server';
import { parseMusicCheck, type MusicCheck, type RawMusicCheck } from '@/lib/import/musicCheck';
import { downloadGate, type Release } from '@/lib/downloadGate';
import { BusyError, createSemaphore, type Semaphore } from '@/lib/semaphore';

// apps/web is one level deeper than the old apps/api in workspace layout,
// but both resolve to the same spotify-clone root.
const ROOT = path.resolve(process.cwd(), '..', '..');

const PYTHON_BIN = process.env.PYTHON_BIN ?? path.join(ROOT, '.venv/bin/python');
const PLAYER_SCRIPT = process.env.PLAYER_SCRIPT ?? path.join(ROOT, 'player.py');
export const MUSIC_DIR = process.env.MUSIC_DIR ?? path.join(ROOT, 'my_music');

const CACHE_EXTS = ['.m4a', '.webm', '.opus', '.mp3', '.mp4'] as const;

export function findCachedFile(videoId: string): string | null {
  for (const ext of CACHE_EXTS) {
    const p = path.join(MUSIC_DIR, `${videoId}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export type UnavailableReason = 'removed' | 'private' | 'geo' | 'members' | 'terminated' | 'unavailable';

/** YouTube's mood, not the video's fate. Checked FIRST, and an unknown
 *  message is transient too: a wrong "unavailable" hides a song from everyone,
 *  a wrong "transient" only costs one more failed play. The rate limit starts
 *  with "Video unavailable. This content isn't available, try again later",
 *  so it must be caught here before the unavailable rules see it. */
const TRANSIENT_RE = /HTTP Error \d{3}|not a bot|confirm your age|timed out|Connection reset|Remote end closed|unable to download|Unable to extract|Failed to extract|Requested format is not available|nsig|Temporary failure|Name or service not known|try again later|rate-limited/i;

const UNAVAILABLE_RULES: [RegExp, UnavailableReason][] = [
  [/account associated with this video has been terminated/i, 'terminated'],
  [/removed by the uploader|has been removed|copyright claim|Terms of Service/i, 'removed'],
  [/Private video|This video is private/i, 'private'],
  [/not available in your country|not made this video available/i, 'geo'],
  [/members-only|channel's members/i, 'members'],
  [/Video unavailable|This video is unavailable|This video is not available|video\b.*does not exist/i, 'unavailable'],
];

export function classifyYtdlpFailure(message: string): UnavailableReason | null {
  if (TRANSIENT_RE.test(message)) return null;
  for (const [re, reason] of UNAVAILABLE_RULES) if (re.test(message)) return reason;
  return null;
}

export function isUnavailableError(e: unknown): e is Error & { status: 410; unavailableReason: UnavailableReason } {
  return !!(e as { unavailableReason?: string } | undefined)?.unavailableReason;
}

interface PythonError extends Error {
  status?: number;
  unavailableReason?: UnavailableReason;
}

// Prepend the venv's bin/ to PATH so yt-dlp can find ffmpeg: update.sh links
// the imageio-ffmpeg binary to .venv/bin/ffmpeg (player.py also hands it to
// yt-dlp as ffmpeg_location, via ffmpeg_path.py). Without ffmpeg, yt-dlp
// downloads fragmented DASH MP4s that <audio> elements refuse.
const VENV_BIN = path.dirname(PYTHON_BIN);
const SUBPROCESS_PATH = `${VENV_BIN}:${process.env.PATH ?? ''}`;

/** One readable line explaining why the helper failed.
 *
 *  yt-dlp's own "ERROR: ..." line is the useful part; everything around it is
 *  a traceback through site-packages. Falls back to a plain statement rather
 *  than dumping raw output. */
function pythonReason(stderr: string, code: number | null): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const ytdlp = [...lines].reverse().find((l) => l.startsWith('ERROR:'));
  if (ytdlp) {
    const cleaned = ytdlp.replace(/^ERROR:\s*/, '').replace(/;\s*please report this issue.*$/i, '');
    return cleaned.slice(0, 200);
  }
  const exception = [...lines].reverse().find((l) => /^[A-Za-z_.]+(Error|Exception):/.test(l));
  if (exception) return exception.slice(0, 200);
  return `the media helper failed (exit ${code ?? '?'})`;
}

/** Python helpers allowed to run at once, per lane (bughunt S04). Search and
 *  every other public route could start one per request with no ceiling, so
 *  a flood of requests was a flood of processes on the host. Each lane has
 *  its own slots so slow work cannot starve quick work: a 3-minute download
 *  or an import's batch never holds the slot a search needs.
 *
 *  Downloads are the third lane, and that lane IS the global download gate
 *  (lib/downloadGate, `MAX_CONCURRENT_DOWNLOADS`, default 2): ensureDownloaded
 *  takes a gate slot and spawns yt-dlp directly, never through runPython, so
 *  a download is counted once and never also holds an interactive slot. The
 *  gate is also where the auto cache's prefetch asks for an idle slot
 *  (`tryAcquireIdle`), so a prefetch can never take a slot a listener is
 *  waiting for.
 *
 *  A job only holds a slot while its own process runs and never waits on
 *  another lane while holding one, so a download that falls back to a stream
 *  lookup (interactive) cannot deadlock: the download's gate slot is already
 *  released by then. Transcription for tabs (lib/tabGenerate.ts) spawns its
 *  own processes and stays outside: it is signed-in only and limited to 5 an
 *  hour per user. */
export type PythonLane = 'interactive' | 'bulk';

function envCap(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const LANES: Record<PythonLane, Semaphore> = {
  // Search, stream lookups, album/artist/track pages, lyrics, trending.
  interactive: createSemaphore(envCap('PYTHON_MAX_CONCURRENCY', 4), { queueTimeoutMs: 15_000, maxQueue: 64 }),
  // Import batches (match, classify, playlist reads): they retry on a 503.
  bulk: createSemaphore(envCap('PYTHON_MAX_BULK', 2), { queueTimeoutMs: 120_000, maxQueue: 64 }),
};

/** How long a listener's cold download may wait for a gate slot, and how
 *  many may wait at once, before it fails with a 503 (the stream route then
 *  falls back to live streaming) instead of queueing forever. */
const DOWNLOAD_QUEUE_TIMEOUT_MS = 60_000;
const DOWNLOAD_MAX_WAITING = 64;

/** One `player.py` run, once its lane has a free slot. A job that waits too
 *  long fails with a 503 instead of queueing forever. */
function runPython<T = unknown>(
  args: string[],
  { timeoutMs = 30000, lane = 'interactive' }: { timeoutMs?: number; lane?: PythonLane } = {},
): Promise<T> {
  return LANES[lane].run(() => spawnPython<T>(args, timeoutMs)).catch((e: unknown) => {
    if (e instanceof BusyError) serverLogger.error('python', 'helper queue full', { lane, command: args[0] });
    throw e;
  });
}

/** The child's stderr is redacted on its way to both the terminal and the
 *  server log, so a helper that ever echoed a credential could not put it
 *  there. */
function spawnPython<T>(args: string[], timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [PLAYER_SCRIPT, ...args], {
      env: { ...process.env, MUSIC_DIR, PATH: SUBPROCESS_PATH },
    });
    let stdout = '';
    let stderr = '';
    const reject_ = (e: PythonError) => {
      serverLogger.error('python', e.message, { args, stderr: stderr.slice(-200) }, e);
      reject(e);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const e: PythonError = new Error('python timed out');
      e.status = 504;
      reject_(e);
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    // Buffer stderr for error reporting AND forward live to Node's stderr so
    // `[search] …` / yt-dlp logs surface in the dev/prod terminal as they
    // happen — not just when the process fails.
    child.stderr.on('data', (d) => {
      const text = redactSecrets(d.toString());
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (e) => { clearTimeout(timer); reject_(e as PythonError); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // The MESSAGE reaches the browser (and toasts), so it must be a
        // sentence, not a Python traceback — those leak absolute server paths
        // and tell the listener nothing. The full stderr still goes to the
        // server log via reject_ below.
        const e: PythonError = new Error(pythonReason(stderr, code));
        e.status = 502;
        const reason = classifyYtdlpFailure(e.message);
        if (reason) { e.status = 410; e.unavailableReason = reason; }
        return reject_(e);
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        // Include the args that triggered this so the next "bad python output"
        // log tells us which call actually failed (info vs. search vs. …).
        const e: PythonError = new Error(`bad python output for [${args.join(' ')}]: ${stdout.slice(0, 200)}`);
        e.status = 502;
        reject_(e);
      }
    });
  });
}

interface RawYoutubeTrack {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string | null;
  album?: string | null;
  albumId?: string | null;
  durationSec?: number;
  artworkUrl: string;
}

function normalize(t: RawYoutubeTrack): Track {
  return {
    id: `youtube:${t.videoId}`,
    sourceId: t.videoId,
    source: 'youtube',
    title: t.title,
    artist: t.artist,
    artistId: t.artistId ?? null,
    album: t.album ?? null,
    albumId: t.albumId ?? null,
    durationSec: t.durationSec ?? 0,
    artworkUrl: t.artworkUrl,
    streamUrl: `/api/youtube/stream/${t.videoId}`,
  };
}

function dedupeByVideoId(tracks: RawYoutubeTrack[]): RawYoutubeTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (!t.videoId || seen.has(t.videoId)) return false;
    seen.add(t.videoId);
    return true;
  });
}

const SEARCH_CACHE = new Map<string, { tracks: Track[]; expires: number }>();
const SEARCH_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 100;

export async function searchTracks(query: string, { limit = 30 } = {}): Promise<Track[]> {
  const key = `${query}:${limit}`;
  const hit = SEARCH_CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.tracks;

  // `--` separates flags from positionals so a query string that starts with
  // `-` doesn't get misparsed as a flag by argparse. Flags come first.
  const results = await runPython<RawYoutubeTrack[]>(['search', '--limit', String(limit), '--', query]);
  const tracks = dedupeByVideoId(results).map(normalize);
  // An empty answer is cheap to ask again and, if search was having a bad
  // moment, would otherwise read "no results" for the next 5 minutes.
  if (!tracks.length) return tracks;

  // Bound the cache. Drop the oldest insertion when we hit the cap — Map
  // iteration order is insertion order in JS. Not strict LRU (we don't
  // bump on hit) but TTL evicts stale entries anyway, and the cap of 100
  // keeps total memory in the low-MB range.
  if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) {
    const oldest = SEARCH_CACHE.keys().next().value;
    if (oldest !== undefined) SEARCH_CACHE.delete(oldest);
  }
  SEARCH_CACHE.set(key, { tracks, expires: Date.now() + SEARCH_TTL_MS });

  return tracks;
}

/** Downloads in flight, keyed by videoId.
 *
 *  Without this, every concurrent request for the same uncached track spawns
 *  its own yt-dlp. That is not rare: a player asking for a byte range opens
 *  several requests for one song, so a single play could kick off three or
 *  four downloads of the same file, all fighting for the same throttled
 *  YouTube budget and racing to write the same path. Callers share one run. */
const inFlight = new Map<string, Promise<string>>();

/** Is yt-dlp currently writing this track?
 *
 *  Matters because a download is NOT atomic: yt-dlp renames the file into
 *  place and then post-processes it, so `<id>.m4a` can exist while still being
 *  written. Serving it in that window hands the player a truncated file — the
 *  decoder starves and playback sits frozen at 0:00 with no error. */
export function isDownloading(videoId: string): boolean {
  return inFlight.has(videoId);
}

/** Returns the path of a finished download, starting one when needed.
 *
 *  A cold download holds one slot of the global download gate
 *  (lib/downloadGate) for as long as yt-dlp runs; joining one already in
 *  flight never takes a slot. `prefetch` marks a low-priority caller (the
 *  auto cache fetching upcoming songs): it may start a cold download only
 *  when the host is idle, and gets a BusyError instead of waiting. */
export async function ensureDownloaded(videoId: string, opts: { prefetch?: boolean } = {}): Promise<string> {
  if (!VIDEO_ID_RE.test(videoId)) {
    const e: PythonError = new Error('invalid videoId');
    e.status = 400;
    throw e;
  }

  // Order matters: join an in-flight download BEFORE trusting the disk. yt-dlp
  // renames the final filename into place and then post-processes it, so while
  // a download is running the file can exist and still be incomplete. Checking
  // the cache first handed callers those truncated bytes.
  const running = inFlight.get(videoId);
  if (running) return running;

  // Nothing running — a file on disk now is genuinely finished.
  const already = findCachedFile(videoId);
  if (already) return already;

  let slot: Release | null = null;
  if (opts.prefetch) {
    slot = downloadGate.tryAcquireIdle();
    if (!slot) throw new BusyError(30);
  }

  const job = (async () => {
    // Registered in inFlight below before this first await, so a caller that
    // arrives while we wait for a slot joins this run instead of queueing.
    // The gate is the download lane: spawn directly, so the download is not
    // counted a second time against an interactive slot.
    let release: Release;
    try {
      release = slot ?? (await downloadGate.acquire({ timeoutMs: DOWNLOAD_QUEUE_TIMEOUT_MS, maxWaiting: DOWNLOAD_MAX_WAITING }));
    } catch (e) {
      if (e instanceof BusyError) serverLogger.error('python', 'download queue full', { videoId });
      throw e;
    }
    try {
      const result = await spawnPython<{ filePath: string }>(['download', '--', videoId], 180000);
      return result.filePath;
    } finally {
      release();
    }
  })()
    .finally(() => {
      // Clear on failure too, so a transient error doesn't poison the track
      // until the process restarts.
      inFlight.delete(videoId);
    });

  inFlight.set(videoId, job);
  return job;
}

/** Resolve a single videoId to track metadata via ytmusicapi get_song.
 *  Returns null when the video doesn't exist / is private. Used by the
 *  shareable /track/<videoId> page for ids not yet in PocketBase. */
export async function getTrack(videoId: string): Promise<Track | null> {
  if (!VIDEO_ID_RE.test(videoId)) {
    const e: PythonError = new Error('invalid videoId');
    e.status = 400;
    throw e;
  }
  const raw = await runPython<RawYoutubeTrack & { error?: string }>(
    ['track', '--', videoId],
    { timeoutMs: 20000 },
  );
  if (!raw || raw.error || !raw.videoId) return null;
  return normalize(raw);
}

/** What `player.py trending` prints: the chart, blended across whichever
 *  countries it was asked for and could fetch, in rank order. */
export interface RawTrendingChart {
  title?: string | null;
  playlistId?: string | null;
  source?: string;
  /** Country codes that actually made it into the blend (player.py skips a
   *  country whose chart fetch failed rather than failing the whole call). */
  countries?: string[];
  tracks?: RawYoutubeTrack[];
}

/** One chart fetch through the player: `countries` is a comma list of chart
 *  country codes (a single code works too). Throws when every country's
 *  chart failed (player.py exits non-zero); lib/trending.ts caches the
 *  result. */
export async function fetchTrendingChart(countries: string): Promise<{ title: string | null; source: string; countries: string[]; tracks: Track[] }> {
  const raw = await runPython<RawTrendingChart | RawYoutubeTrack[]>(['trending', '--countries', countries], { timeoutMs: 60000 });
  return parseTrendingChart(raw);
}

/** Player output to Tracks. Order is the chart rank, so it is kept as is;
 *  duplicates keep their first (higher) position. Also accepts the old bare
 *  array output. */
export function parseTrendingChart(raw: RawTrendingChart | RawYoutubeTrack[] | null | undefined) {
  const chart: RawTrendingChart = Array.isArray(raw) ? { tracks: raw } : (raw ?? {});
  const tracks = dedupeByVideoId((chart.tracks ?? []).filter((t) => t && VIDEO_ID_RE.test(t.videoId ?? ''))).map(normalize);
  return { title: chart.title ?? null, source: chart.source ?? 'ytmusicapi', countries: chart.countries ?? [], tracks };
}

interface RecommendedArgs {
  seed?: string;
  country?: string;
  limit?: number;
}

export async function getRecommended({ seed, country = 'ZZ', limit = 30 }: RecommendedArgs = {}): Promise<Track[]> {
  const args = ['recommended', '--country', country, '--limit', String(limit)];
  // `--seed=<id>` (not `--seed <id>`) so a hyphen-leading videoId (legal per
  // VIDEO_ID_RE, e.g. "-UaaeSP971U") is never mistaken by argparse for
  // another option. `--` can't help here since --seed is an optional, not
  // a positional.
  if (seed && VIDEO_ID_RE.test(seed)) args.push(`--seed=${seed}`);
  const results = await runPython<RawYoutubeTrack[]>(args);
  return dedupeByVideoId(results).map(normalize);
}

interface RawArtist {
  name?: string;
  description?: string | null;
  thumbnails?: { url: string }[];
  tracks?: RawYoutubeTrack[];
  albums?: unknown[];
  singles?: unknown[];
  error?: string;
}

interface RawAlbumDetail {
  title?: string;
  artist?: string;
  artistId?: string | null;
  year?: number | null;
  thumbnails?: { url: string; width?: number; height?: number }[];
  trackCount?: number;
  totalDurationSec?: number;
  tracks?: RawYoutubeTrack[];
  error?: string;
}

const ALBUM_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

export async function getAlbum(browseId: string) {
  if (!ALBUM_ID_RE.test(browseId)) {
    const e: PythonError = new Error('invalid albumId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<RawAlbumDetail>(['album', '--', browseId], { timeoutMs: 30000 });
  if (result?.error) {
    const e: PythonError = new Error(result.error);
    e.status = 502;
    throw e;
  }
  return {
    title: result?.title ?? 'Album',
    artist: result?.artist ?? 'Unknown',
    artistId: result?.artistId ?? null,
    year: result?.year ?? null,
    thumbnails: result?.thumbnails ?? [],
    trackCount: result?.trackCount ?? 0,
    totalDurationSec: result?.totalDurationSec ?? 0,
    tracks: (result?.tracks ?? []).filter((t) => t.videoId).map(normalize),
  };
}

const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,60}$/;

interface RawYtPlaylist {
  title?: string;
  tracks?: RawYoutubeTrack[];
  error?: string;
  reason?: 'private' | 'not-found' | 'failed';
}

const YT_PLAYLIST_ERRORS: Record<NonNullable<RawYtPlaylist['reason']>, [string, number]> = {
  private: ['That playlist is private. Set it to public or unlisted on YouTube Music, then try again.', 403],
  'not-found': ["Couldn't find that playlist. Check the link and try again.", 404],
  failed: ["Couldn't read that playlist from YouTube Music right now. Try again in a moment.", 502],
};

/** Public YT Music (or YouTube) playlist -> name + normalized tracks.
 *  player.py reads it with ytmusicapi and falls back to yt-dlp. */
export async function getYtPlaylist(playlistId: string): Promise<{ name: string; tracks: Track[] }> {
  if (!PLAYLIST_ID_RE.test(playlistId)) {
    const e: PythonError = new Error("That doesn't look like a playlist link.");
    e.status = 400;
    throw e;
  }
  const result = await runPython<RawYtPlaylist>(['ytplaylist', '--', playlistId], { timeoutMs: 90000, lane: 'bulk' });
  if (result?.error) {
    const [message, status] = YT_PLAYLIST_ERRORS[result.reason ?? 'failed'] ?? YT_PLAYLIST_ERRORS.failed;
    const e: PythonError = new Error(message);
    e.status = status;
    throw e;
  }
  return {
    name: result?.title ?? 'Imported playlist',
    tracks: dedupeByVideoId(result?.tracks ?? []).map(normalize),
  };
}

/** A raw search hit from `player.py match`: the track plus what the scorer
 *  reads. Unscored; lib/import/match.ts scores it. */
export interface RawMatchCandidate {
  track: Track;
  artists: string[];
  videoType: string | null;
  explicit: boolean | null;
}

interface RawCandidateJson extends RawYoutubeTrack {
  artists?: string[];
  videoType?: string | null;
  isExplicit?: boolean | null;
}

interface RawMatchResult {
  results?: (RawCandidateJson[] | null)[];
  /** Indexes whose search raised: "could not ask", not "nothing found". */
  failed?: number[];
}

/** Up to 5 YT Music candidates per {title, artist} item (8 or fewer items per
 *  call), in input order. `titleOnly` searches the title alone with
 *  ignore_spelling, the second try for items the first search missed. Import
 *  batches use the bulk lane; a listener waiting on the answer passes
 *  'interactive'. */
export async function searchMatchCandidates(
  items: { title: string; artist: string }[],
  { titleOnly = false, lane = 'bulk' }: { titleOnly?: boolean; lane?: PythonLane } = {},
): Promise<RawMatchCandidate[][]> {
  if (!items.length) return [];
  const queries = items.map((i) => `${i.title}\t${i.artist}`);
  const args = ['match', ...(titleOnly ? ['--title-only'] : []), '--', ...queries];
  const result = await runPython<RawMatchResult>(args, { timeoutMs: 60000, lane });
  if (result?.failed?.length) {
    // Usually YouTube Music's 503 for searching too fast. The import runner
    // backs off and repeats the batch rather than calling these not found.
    const e: PythonError = new Error('YouTube Music search failed, try again shortly');
    e.status = 503;
    throw e;
  }
  const rows = result?.results ?? [];
  return items.map((_, i) =>
    (rows[i] ?? [])
      .filter((r) => r && r.videoId)
      .map((r) => ({
        track: normalize(r),
        // "Unknown" is to_track_json's placeholder, not an artist: leave it
        // out so the scorer sees no artist data rather than a different one.
        artists: r.artists?.length ? r.artists : [r.artist].filter((a) => a && a !== 'Unknown'),
        videoType: r.videoType ?? null,
        explicit: typeof r.isExplicit === 'boolean' ? r.isExplicit : null,
      })),
  );
}

/** YouTube Music's own type for each liked video (8 or fewer per call, from
 *  the import runner): ATV, OMV, UGC or null. Throws when YouTube Music asks
 *  to slow down, so the runner backs off; one video failing is only listed
 *  in `failed`. */
export async function classifyVideos(videoIds: string[]): Promise<MusicCheck> {
  if (!videoIds.length) return { types: new Map(), failed: [] };
  const raw = await runPython<RawMusicCheck>(['classify', '--', ...videoIds], { timeoutMs: 60000, lane: 'bulk' });
  return parseMusicCheck(raw, videoIds);
}

export async function getArtist(channelId: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(channelId)) {
    const e: PythonError = new Error('invalid artistId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<RawArtist>(['artist', '--', channelId], { timeoutMs: 30000 });
  if (result?.error) {
    const e: PythonError = new Error(result.error);
    e.status = 502;
    throw e;
  }
  return {
    name: result?.name ?? 'Artist',
    description: result?.description ?? null,
    thumbnails: result?.thumbnails ?? [],
    tracks: (result?.tracks ?? []).filter((t) => t.videoId).map(normalize),
    albums: result?.albums ?? [],
    singles: result?.singles ?? [],
  };
}

interface StreamInfo {
  url: string;
  ext?: string;
  /** Headers yt-dlp used to resolve the format URL (notably User-Agent). The
   *  proxy must replay these when fetching googlevideo or it gets a 403. */
  httpHeaders?: Record<string, string>;
}

const URL_CACHE = new Map<string, { info: StreamInfo; expires: number }>();
// Fallback TTL when the upstream URL carries no readable expiry. googlevideo
// URLs are signed for ~6h, so an hour is still conservative.
const URL_TTL_MS = 60 * 60 * 1000;

/** Cache lifetime for a resolved stream URL. googlevideo URLs embed their own
 *  signed expiry (`expire=<unix seconds>`); trust it minus a 10-min margin.
 *  The old flat 5-min TTL made every timestamp-slider seek PAST the 5-minute
 *  mark re-spawn yt-dlp (seconds of lag) — i.e. long tracks always lagged. */
function urlCacheExpiry(url: string): number {
  try {
    const expire = Number(new URL(url).searchParams.get('expire'));
    if (Number.isFinite(expire) && expire > 0) {
      const ms = expire * 1000 - 10 * 60 * 1000;
      if (ms > Date.now()) return Math.min(ms, Date.now() + 6 * 60 * 60 * 1000);
    }
  } catch {
    // unparseable URL — fall through to the flat TTL
  }
  return Date.now() + URL_TTL_MS;
}

interface RawLyrics {
  lyrics?: string | null;
  source?: 'genius' | 'none';
  url?: string;
  error?: string;
}

export interface LyricsLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface LyricsResult {
  lyrics: string | null;
  source: 'genius' | 'lrclib' | 'none';
  url: string | null;
  /** Time-synced lines when the source provides them. Empty/undefined
   *  means we only have plain text — the UI renders it as a single block. */
  synced?: LyricsLine[];
}

const LYRICS_CACHE = new Map<string, { result: LyricsResult; expires: number }>();
const LYRICS_TTL_MS = 60 * 60 * 1000;

/** Parse LRC body into sorted {time, text} entries. Tolerates the common
 *  `[mm:ss.xx]` and `[mm:ss]` forms, multiple stamps per line, and metadata
 *  tags like `[ar:...]`/`[ti:...]` which we silently skip. */
function parseLRC(body: string): LyricsLine[] {
  const stampRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const lines: LyricsLine[] = [];
  for (const raw of body.split('\n')) {
    const stamps: number[] = [];
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    stampRe.lastIndex = 0;
    while ((m = stampRe.exec(raw)) !== null) {
      const mm = Number(m[1]);
      const ss = Number(m[2]);
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      stamps.push(mm * 60 + ss + frac);
      lastEnd = stampRe.lastIndex;
    }
    if (stamps.length === 0) continue;
    const text = raw.slice(lastEnd).trim();
    for (const t of stamps) lines.push({ time: t, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

interface RawLrclibHit {
  id?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

/** YouTube titles arrive with cruft like "(Official Music Video)" or
 *  "feat. X" that LRCLib's matcher trips over. Strip the noise so a track
 *  like "Until the World Goes Cold (Official Music Video)" looks up as
 *  just "Until the World Goes Cold". */
function cleanForLyricsLookup(s: string): string {
  return s
    .replace(/\s*[\[(][^\])]*\b(official|lyric|lyrics|music|audio|video|hd|hq|4k|live|remaster(ed)?|visualizer|mv|m\/v)\b[^\])]*[\])]/gi, '')
    .replace(/\s*[-–—]\s*(official|lyric|lyrics|music|audio|video|hd|hq|4k|live|remaster(ed)?)\b.*$/i, '')
    .replace(/\s*[\[(]?\bfeat(?:uring)?\.?\b[^)\]]*[\])]?/gi, '')
    .replace(/\s*[\[(]?\bft\.\b[^)\]]*[\])]?/gi, '')
    .replace(/\s+VEVO\b/gi, '')
    .replace(/\s+-\s+Topic\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** LRCLib is a community database that returns both `syncedLyrics` (LRC
 *  format) and `plainLyrics` for a track. No auth, no rate limits to speak
 *  of. We try it first because it's the only source we have with timing
 *  info — falling back to Genius (via the Python scraper) only when LRCLib
 *  has nothing.
 *
 *  Uses /api/search (fuzzy) rather than /api/get (exact) because YouTube
 *  metadata almost never matches LRCLib's clean artist/title strings. */
async function fetchLrclib(title: string, artist: string): Promise<LyricsResult | null> {
  const cleanTitle = cleanForLyricsLookup(title);
  const cleanArtist = cleanForLyricsLookup(artist);
  const params = new URLSearchParams({ track_name: cleanTitle });
  if (cleanArtist) params.set('artist_name', cleanArtist);
  const url = `https://lrclib.net/api/search?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Ember (+https://github.com/ParalelSt/ember)' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const hits = (await res.json().catch(() => null)) as RawLrclibHit[] | null;
  if (!Array.isArray(hits) || hits.length === 0) return null;

  // Prefer a hit that actually has synced lyrics — that's the whole point
  // of going to LRCLib. Fall back to the first hit otherwise.
  const hit =
    hits.find((h) => !h.instrumental && h.syncedLyrics && h.syncedLyrics.trim().length > 0)
    ?? hits.find((h) => !h.instrumental && h.plainLyrics);
  if (!hit) return null;

  const synced = hit.syncedLyrics ? parseLRC(hit.syncedLyrics) : [];
  const plain = (hit.plainLyrics ?? '').trim()
    || (synced.length ? synced.map((l) => l.text).join('\n') : '');
  if (!plain && synced.length === 0) return null;
  return {
    lyrics: plain || null,
    source: 'lrclib',
    url: null,
    synced: synced.length ? synced : undefined,
  };
}

export async function getLyrics(title: string, artist: string): Promise<LyricsResult> {
  const cleanTitle = title.trim().slice(0, 200);
  const cleanArtist = artist.trim().slice(0, 200);
  if (!cleanTitle) {
    const e: PythonError = new Error('missing title');
    e.status = 400;
    throw e;
  }
  // v2 = LRCLib (synced) path added. Bumping ensures any v1-era cached
  // entries (Genius-only, no `synced`) don't shadow newer lookups.
  const cacheKey = `v2:${cleanArtist}::${cleanTitle}`.toLowerCase();
  const cached = LYRICS_CACHE.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.result;

  // Prefer LRCLib because it can give us synced timing. If it has nothing
  // useful, fall back to Genius via the Python scraper for the plain text.
  const fromLrclib = await fetchLrclib(cleanTitle, cleanArtist);
  if (fromLrclib) {
    LYRICS_CACHE.set(cacheKey, { result: fromLrclib, expires: Date.now() + LYRICS_TTL_MS });
    return fromLrclib;
  }

  const raw = await runPython<RawLyrics>(['lyrics', '--', cleanTitle, cleanArtist], { timeoutMs: 20000 });
  if (raw?.error) {
    const e: PythonError = new Error(raw.error);
    e.status = 502;
    throw e;
  }
  const result: LyricsResult = {
    lyrics: raw?.lyrics ?? null,
    source: raw?.source ?? 'none',
    url: raw?.url ?? null,
  };
  LYRICS_CACHE.set(cacheKey, { result, expires: Date.now() + LYRICS_TTL_MS });
  return result;
}

/** Drop a cached stream URL so the next resolve re-extracts. Used when the
 *  upstream 403s: the signed URL may have gone stale inside its own expiry. */
export function invalidateStreamUrl(videoId: string): void {
  URL_CACHE.delete(videoId);
}

/** Would the next resolveStreamUrl answer from the cache?
 *
 *  The stream route asks before it fetches: a 403 on a REPLAYED url can mean
 *  the signature went stale and is worth one re-extraction, while a 403 on a
 *  url yt-dlp produced moments ago means YouTube is refusing us, and running
 *  yt-dlp again to hear that twice only makes the listener wait. */
export function hasCachedStreamUrl(videoId: string): boolean {
  const cached = URL_CACHE.get(videoId);
  return !!cached && cached.expires > Date.now();
}

export async function resolveStreamUrl(videoId: string): Promise<StreamInfo> {
  if (!VIDEO_ID_RE.test(videoId)) {
    const e: PythonError = new Error('invalid videoId');
    e.status = 400;
    throw e;
  }
  const cached = URL_CACHE.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.info;
  const info = await runPython<StreamInfo>(['info', '--', videoId], { timeoutMs: 30000 });
  if (!info?.url) {
    const e: PythonError = new Error('no upstream URL');
    e.status = 502;
    throw e;
  }
  URL_CACHE.set(videoId, { info, expires: urlCacheExpiry(info.url) });
  return info;
}
