import type { NextRequest } from 'next/server';
import { noteYtdlpDownloadFailure } from '@/lib/ytdlp/upgradeRunner';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  ensureDownloaded,
  findCachedFile,
  hasCachedStreamUrl,
  invalidateStreamUrl,
  isDownloading,
  isTooLargeError,
  isUnavailableError,
  resolveStreamUrl,
  type UnavailableReason,
} from '@/lib/sources/youtube';
import {
  fetchWithHeadersTimeout,
  UPSTREAM_HEADERS_TIMEOUT_MS,
  UPSTREAM_STALL_TIMEOUT_MS,
  withStallTimeout,
} from '@/lib/streamGuard';
import { fromError } from '@/lib/upsertTrack';
import { serverLogger } from '@/lib/logger/server';
import { queueCacheWarm } from '@/lib/streamCache';
import { clearTrackUnavailable, freshUnavailableMark, listUnavailableIds, markTrackUnavailable } from '@/lib/trackAvailability';
import { forgetFailure, recentFailure, rememberTransient, rememberUnavailable } from '@/lib/sources/failureMemo';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { isBusyError } from '@/lib/downloadGate';
import { busyResponse, isPrefetchRequest, PREFETCH_HEADERS, prefetchLimitResponse } from '@/lib/prefetch';
import { newFetchLimitResponse, signedInMember, signInToFetchResponse } from '@/lib/downloadAccess';
import { tooLargeResponse } from '@/lib/mediaLimits';
import { streamTokenUser } from '@/lib/streamToken';
import { STREAM_RETRY_PARAM } from '@/lib/playback/unplayable';

const MIME_BY_EXT: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/** Where audio comes from when it isn't on disk yet.
 *
 *  'cache' (the DEFAULT): download it with yt-dlp, then serve the file. The
 *  local copy is the real source of truth, a played song is on disk forever
 *  after, and playback never depends on a signed googlevideo URL staying valid
 *  mid-song.
 *
 *  'proxy': stream YouTube through to the client live. Starts faster the very
 *  first time, but it's the path that produces 403s, those URLs are signed
 *  for the resolving client and expire, and native players (which fetch byte
 *  ranges over several connections) trip over that far more than a browser
 *  does. Kept behind STREAM_MODE=proxy for anyone who prefers the speed. */
function streamMode(): 'cache' | 'proxy' {
  const m = (process.env.STREAM_MODE ?? 'cache').toLowerCase();
  return m === 'proxy' ? 'proxy' : 'cache';
}

/** Strips path separators / quotes / control chars from a download filename
 *  so the Content-Disposition stays a valid one-segment file name. */
function sanitizeFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

interface DownloadIntent {
  filename: string;
}

function downloadIntent(request: NextRequest, ext: string | undefined): DownloadIntent | null {
  if (request.nextUrl.searchParams.get('download') !== '1') return null;
  const title  = sanitizeFilename(request.nextUrl.searchParams.get('title')  ?? '');
  const artist = sanitizeFilename(request.nextUrl.searchParams.get('artist') ?? '');
  const base = artist && title ? `${artist} - ${title}` : (title || artist || 'track');
  const cleanExt = (ext || 'm4a').replace(/^\./, '').toLowerCase().slice(0, 5);
  return { filename: `${base}.${cleanExt}` };
}

/** Headers.set() throws on any value outside Latin-1, and a title full of
 *  non-Latin1 characters (CJK, Cyrillic, emoji, ...) reaches sanitizeFilename
 *  untouched, so a plain `filename="..."` 500s the whole request. RFC 5987's
 *  `filename*=UTF-8''...` carries the real name for browsers that understand
 *  it, alongside an ASCII-only `filename=` fallback for those that don't. */
function asciiFallbackFilename(s: string): string {
  const ascii = s.replace(/[^\x20-\x7E]/g, '_').trim();
  return ascii || 'track';
}

function withDownload(headers: Headers, intent: DownloadIntent | null): Headers {
  if (intent) {
    const ascii = asciiFallbackFilename(intent.filename);
    const utf8 = encodeURIComponent(intent.filename);
    headers.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`);
  }
  return headers;
}

function serveFile(
  filePath: string,
  range: string | null,
  intent: DownloadIntent | null,
  extra: Record<string, string> = {},
): Response {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const stat = fs.statSync(filePath);

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      const hasStart = match[1] !== '';
      const hasEnd = match[2] !== '';
      let start: number;
      let end: number;
      if (!hasStart) {
        // Suffix range (bytes=-N): the LAST N bytes of the file, not the
        // first N. An absent start is not "start at 0".
        const suffixLength = parseInt(match[2], 10);
        start = Math.max(0, stat.size - suffixLength);
        end = stat.size - 1;
      } else {
        start = parseInt(match[1], 10);
        // Clamp a requested end past EOF instead of trusting the client;
        // Content-Length below must match what's actually sent.
        end = Math.min(hasEnd ? parseInt(match[2], 10) : stat.size - 1, stat.size - 1);
      }
      if (start >= stat.size || start > end) {
        // Unsatisfiable range (e.g. start past the end of the file): 416,
        // not a 500 from handing createReadStream a negative length.
        return new Response(null, {
          status: 416,
          headers: withDownload(new Headers({ ...extra, 'Content-Range': `bytes */${stat.size}` }), intent),
        });
      }
      const chunk = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      const headers = new Headers({
        ...extra,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunk),
        'Content-Type': mime,
      });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: withDownload(headers, intent),
      });
    }
  }
  const stream = fs.createReadStream(filePath);
  const headers = new Headers({
    ...extra,
    'Content-Length': String(stat.size),
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
  });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: withDownload(headers, intent),
  });
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Never kept by the browser: a 410 is cacheable by default, and a player
 *  answered from its own cache never reaches this host, which then cannot
 *  tell the page why the song failed (seen live: "Couldn't load" instead of
 *  "not available on YouTube" after a restart). Answering again is cheap:
 *  the host remembers (knownFailureResponse). */
const NO_STORE = { 'Cache-Control': 'no-store' };

function unavailableResponse(e: Error & { unavailableReason: UnavailableReason }) {
  return Response.json({ error: e.message, unavailable: true, reason: e.unavailableReason }, { status: 410, headers: NO_STORE });
}

/** YouTube's "this video is gone": flag it for every listener (the database
 *  row, when the song has one) and for this process (the memo, which also
 *  covers radio songs nobody has saved), then answer 410. */
async function answerUnavailable(videoId: string, e: Error & { unavailableReason: UnavailableReason }) {
  rememberUnavailable(videoId, e.unavailableReason, e.message);
  await markTrackUnavailable(`youtube:${videoId}`, e.unavailableReason);
  return unavailableResponse(e);
}

async function flagRowIfMissing(videoId: string, reason: UnavailableReason): Promise<void> {
  const id = `youtube:${videoId}`;
  if (!(await listUnavailableIds()).has(id)) await markTrackUnavailable(id, reason);
}

/** What the host already knows about a video that would not play, checked
 *  BEFORE any yt-dlp run: a 410 for one flagged unavailable (in the database
 *  within its recheck window, or remembered by this process), a quick 502
 *  for one that failed to load in the last two minutes. The player's own
 *  retries, a prefetch followed by the real play, and radio walking into a
 *  dead song used to run yt-dlp two to four times for the same refusal.
 *
 *  `listenerRetry`: the listener tapped "Tap to retry" (the player marks
 *  that load, lib/playback/unplayable retryStreamUrl). A passing failure is
 *  then not answered from memory: the bar offers a retry, and answering it
 *  with the remembered failure meant the button could not work for two
 *  minutes. A video YouTube says is gone is still answered at once. */
async function knownFailureResponse(videoId: string, listenerRetry = false): Promise<Response | null> {
  const known = recentFailure(videoId);
  if (known?.kind === 'unavailable') {
    serverLogger.info('stream', 'known unavailable, not asking YouTube again', { videoId, reason: known.reason });
    // The song may have been saved since it was found gone (the first play
    // saves it after its stream was already refused): flag that row too, so
    // the flag outlives this process. Only when the flag list lacks it, so
    // a flagged song costs no database write per request.
    void flagRowIfMissing(videoId, known.reason);
    return unavailableResponse(Object.assign(new Error(known.message), { unavailableReason: known.reason }));
  }
  const mark = await freshUnavailableMark(`youtube:${videoId}`);
  if (mark) {
    const message = 'This video is not available on YouTube';
    rememberUnavailable(videoId, mark.reason, message);
    serverLogger.info('stream', 'flagged unavailable, not asking YouTube again', { videoId, reason: mark.reason });
    return unavailableResponse(Object.assign(new Error(message), { unavailableReason: mark.reason }));
  }
  if (known?.kind === 'transient' && !listenerRetry) {
    serverLogger.info('stream', 'failed moments ago, not asking YouTube again yet', { videoId });
    return Response.json(
      { error: `This song could not be loaded right now (${known.message}).`, cause: 'stream-failed', recent: true },
      { status: 502, headers: { ...NO_STORE, 'Retry-After': String(Math.max(1, Math.ceil((known.until - Date.now()) / 1000))) } },
    );
  }
  return null;
}

/** The answer when neither the download nor the live stream can produce audio.
 *
 *  It has to be a real error STATUS, and it has to be quick. A player cannot
 *  tell a server that is still working from one that never will, so anything
 *  else (an endless wait, or a 200 whose body never arrives) shows up as the
 *  app freezing on a song. 502: the track is fine, the thing we fetch it from
 *  is not, so this is not cached and not flagged. */
function cannotLoadResponse(videoId: string, detail: string) {
  serverLogger.error('stream', 'nothing could serve this track', { videoId, detail });
  // Remembered briefly, so the player's immediate retries get this answer at
  // once instead of each waiting through the same failure again.
  rememberTransient(videoId, detail);
  return Response.json(
    { error: `This song could not be loaded right now (${detail}).`, cause: 'stream-failed' },
    { status: 502, headers: NO_STORE },
  );
}

/** clearTrackUnavailable does a fresh admin login on every call: firing it
 *  on every successful play (the overwhelming common case) would mean an
 *  admin login per play for no reason. Gate it behind the (60s-cached)
 *  unavailable set: a normal play just does a Set lookup, and only a track
 *  that was actually flagged pays for the write. Fire-and-forget, same as
 *  the write itself, so the response never waits on it. */
async function clearIfFlagged(videoId: string): Promise<void> {
  forgetFailure(videoId);
  const id = `youtube:${videoId}`;
  if ((await listUnavailableIds()).has(id)) void clearTrackUnavailable(id);
}

export const GET = withRequestLog('youtube/stream/[videoId]', async (request: NextRequest, ctx: RouteContext<'/api/youtube/stream/[videoId]'>) => {
  const { videoId } = await ctx.params;
  // Validate up front so a malformed id can't reach findCachedFile
  // (path.join risk), ensureDownloaded, or resolveStreamUrl. Failed
  // validation downstream was sometimes surfacing as a Python "missing
  // required arg" error instead of a clean 400.
  if (!VIDEO_ID_RE.test(videoId)) {
    return new Response('invalid videoId', { status: 400 });
  }
  const range = request.headers.get('range');
  // The auto cache fetching an upcoming song (lib/prefetch). Low priority:
  // rate limited per listener, and never allowed to make a playing listener
  // wait for a download slot.
  const prefetch = isPrefetchRequest(request);
  if (prefetch) {
    const limited = await prefetchLimitResponse(request);
    if (limited) return limited;
  }
  const fileHeaders = prefetch ? PREFETCH_HEADERS : {};
  // Set once yt-dlp has already refused this track in THIS request. Every step
  // below that would spend more seconds on yt-dlp is pointless then, and
  // seconds are exactly what the listener is losing. Declared out here so the
  // catch can tell "the fallback broke too" from an ordinary failure.
  let downloadFailure: string | null = null;
  try {
    // A file that exists but is still being downloaded must NOT be served:
    // yt-dlp renames into place before post-processing, so the bytes on disk
    // can be incomplete. Fall through and await the in-flight download instead.
    const cached = isDownloading(videoId) ? null : findCachedFile(videoId);
    if (cached) {
      // A file restored out of band (backup, manual copy) must un-grey the
      // track even though this request never called ensureDownloaded.
      void clearIfFlagged(videoId);
      const intentCached = downloadIntent(request, path.extname(cached).slice(1));
      return serveFile(cached, range, intentCached, fileHeaders);
    }

    // Known dead (or failed a moment ago): answer now, before anything below
    // spends a download slot and seconds of yt-dlp on the same refusal. A
    // copy on disk (above) still wins: it plays whatever YouTube says.
    const known = await knownFailureResponse(videoId, request.nextUrl.searchParams.get(STREAM_RETRY_PARAM) === '1');
    if (known) return known;

    // Everything below can make the host fetch from YouTube, with its own
    // cookies and disk: members only, on a per-member budget (security audit
    // 2026-09-25, M2). A song on disk (above) stays public, so a shared
    // /track link still plays for a friend who is not signed in. Joining a
    // download already running costs nothing, so only a new one is counted.
    // A cast device has no cookie: a signed link for THIS song (lib/
    // streamToken) stands in for the member it was issued to, and spends
    // that member's budget.
    const member = streamTokenUser(request, `youtube:${videoId}`, 'stream') ?? await signedInMember();
    if (!member) return signInToFetchResponse();
    if (!isDownloading(videoId)) {
      const limited = newFetchLimitResponse(member);
      if (limited) return limited;
    }

    // A prefetch takes the download path in every STREAM_MODE: proxying
    // googlevideo is where 403s come from, and it would not leave the song on
    // disk for the listener's real play. It may start a cold yt-dlp only when
    // the host is idle; otherwise it is told to come back, and the song is
    // queued to warm right away so the retry finds it on disk.
    if (prefetch) {
      try {
        const filePath = await ensureDownloaded(videoId, { prefetch: true });
        void clearIfFlagged(videoId);
        return serveFile(filePath, range, null, fileHeaders);
      } catch (e) {
        if (isTooLargeError(e)) return tooLargeResponse(e.message);
        if (isBusyError(e)) {
          queueCacheWarm(videoId, { delayMs: 0 });
          return busyResponse(e.retryAfter);
        }
        if (isUnavailableError(e)) return answerUnavailable(videoId, e);
        return cannotLoadResponse(videoId, e instanceof Error ? e.message : 'the download failed');
      }
    }

    // Force the cache path for download-intent requests even when STREAM_MODE
    // is 'proxy'. yt-dlp writes the file to MUSIC_DIR once; subsequent
    // downloads of the same track hit findCachedFile() above and are instant.
    const isDownload = request.nextUrl.searchParams.get('download') === '1';
    if (streamMode() === 'cache' || isDownload) {
      try {
        const filePath = await ensureDownloaded(videoId);
        // Playable again (or always was): a stale flag from an earlier
        // failure must not keep hiding it once yt-dlp succeeds.
        void clearIfFlagged(videoId);
        const intentCached = downloadIntent(request, path.extname(filePath).slice(1));
        return serveFile(filePath, range, intentCached);
      } catch (e) {
        // Over the length or size cap: streaming it live instead would be
        // the very thing the cap is there to stop.
        if (isTooLargeError(e)) return tooLargeResponse(e.message);
        // A removed video has no live stream either, so don't fall through
        // to proxy mode below: a second yt-dlp run only adds seconds before
        // the same definitive failure.
        if (isUnavailableError(e)) return answerUnavailable(videoId, e);
        // A save-to-disk request has nowhere else to go.
        if (isDownload) throw e;
        // Otherwise: don't let a failed download mean silence. yt-dlp's
        // downloader gets 403'd by YouTube long before URL resolution does,
        // most often because the host's yt-dlp has gone stale (YouTube breaks
        // old versions every few months; `pip install -U yt-dlp` is the fix,
        // and update.sh now does it). Live streaming frequently still works in
        // that state, so fall through to it rather than failing the play.
        downloadFailure = e instanceof Error ? e.message : 'the download failed';
        // A run of 403s asks the host to upgrade its yt-dlp (lib/ytdlp).
        noteYtdlpDownloadFailure(downloadFailure);
        serverLogger.error(
          'stream',
          'download failed, falling back to live stream (is yt-dlp up to date?)',
          { videoId },
          e,
        );
      }
    }

    // Proxy mode: fetch upstream with same Range and pipe through. Replay the
    // headers yt-dlp used to resolve the URL (esp. User-Agent), googlevideo
    // URLs are signed for the resolving client, so a generic UA gets a 403.
    // Drop Accept-Encoding: we stream raw bytes and don't forward
    // Content-Encoding, so requesting gzip would hand the browser undecodable
    // audio.
    const fetchUpstream = async (info: Awaited<ReturnType<typeof resolveStreamUrl>>) => {
      const upstreamHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(info.httpHeaders ?? {})) {
        if (typeof v === 'string' && k.toLowerCase() !== 'accept-encoding') upstreamHeaders[k] = v;
      }
      if (!Object.keys(upstreamHeaders).some((k) => k.toLowerCase() === 'user-agent')) {
        upstreamHeaders['User-Agent'] = 'Mozilla/5.0';
      }
      if (range) upstreamHeaders.Range = range;
      // Bounded: googlevideo answering with headers is one CDN request, and a
      // fetch that never resolves (Node puts no clock on one) is a request the
      // client waits on forever. The clock covers the HEADERS only, the body
      // is a whole song, and gets the stall guard below instead.
      return fetchWithHeadersTimeout(
        info.url,
        { headers: upstreamHeaders },
        UPSTREAM_HEADERS_TIMEOUT_MS,
      );
    };

    // Whether the URL we are about to use came out of the cache, which is the
    // only case where a 403 is worth a second extraction (see below).
    const wasCached = hasCachedStreamUrl(videoId);
    let info = await resolveStreamUrl(videoId);
    let upstream = await fetchUpstream(info);

    // 403 cascade. Step 1: a CACHED signed URL may have gone stale inside its
    // own expiry, drop it, re-extract, and try once more. A URL that was just
    // extracted gets no retry: re-running yt-dlp to be told the same thing
    // costs seconds the listener spends staring at a song that will not start.
    if (upstream.status === 403 && wasCached) {
      serverLogger.error('stream', 'upstream 403, refreshing signed URL', { videoId });
      invalidateStreamUrl(videoId);
      info = await resolveStreamUrl(videoId);
      upstream = await fetchUpstream(info);
    }

    // Step 2: still refused. Let yt-dlp fetch the file itself (a fresh
    // extraction with a matching session often succeeds where replaying a URL
    // fails) and serve from disk. If YouTube is blocking the host's IP
    // outright this fails too, then the error below is the honest answer,
    // and the fix is host-side cookies (see SETUP.md).
    //
    // Unless the download already failed in this same request: it is the whole
    // reason we are proxying, and asking it again only adds a second yt-dlp run
    // (tens of seconds) before the same refusal.
    if (upstream.status === 403) {
      if (downloadFailure) {
        return cannotLoadResponse(videoId, downloadFailure);
      }
      serverLogger.error('stream', 'upstream 403 after refresh, downloading instead', { videoId });
      const filePath = await ensureDownloaded(videoId);
      const intentDl = downloadIntent(request, path.extname(filePath).slice(1));
      return serveFile(filePath, range, intentDl);
    }

    // Any other refusal from upstream, with the download already gone: say so
    // rather than forwarding an HTML/JSON error body under an audio status,
    // which a player can only discover by failing to decode it.
    if (!upstream.ok && downloadFailure) {
      return cannotLoadResponse(videoId, `the live stream answered ${upstream.status}`);
    }

    const respHeaders = new Headers();
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }
    if (!respHeaders.has('content-type')) {
      const fallback = info.ext === 'm4a' ? 'audio/mp4' : info.ext === 'webm' ? 'audio/webm' : 'application/octet-stream';
      respHeaders.set('content-type', fallback);
    }
    // Served live, now pull it to disk so the next play skips YouTube entirely.
    if (upstream.ok) {
      queueCacheWarm(videoId);
      void clearIfFlagged(videoId);
    }
    const intent = downloadIntent(request, info.ext);
    // A proxied body that goes quiet must break, not hang: see lib/streamGuard.
    const guarded = withStallTimeout(upstream.body, UPSTREAM_STALL_TIMEOUT_MS, (err) =>
      serverLogger.error('stream', 'the live stream stalled mid-body', { videoId }, err),
    );
    return new Response(guarded, { status: upstream.status, headers: withDownload(respHeaders, intent) });
  } catch (e) {
    if (isTooLargeError(e)) return tooLargeResponse(e.message);
    if (isUnavailableError(e)) return answerUnavailable(videoId, e);
    // A live stream that could not even be reached, when the download had
    // already failed, is the "nothing can serve this" case: answer it as such
    // instead of a bare 500 whose message ("fetch failed") means nothing.
    if (downloadFailure) {
      return cannotLoadResponse(videoId, downloadFailure);
    }
    return fromError(e);
  }
});
