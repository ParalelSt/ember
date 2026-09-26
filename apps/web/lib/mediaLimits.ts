/** How long, and how big, a song the host fetches from YouTube may be
 *  (security audit 2026-09-25, M2). Every fetch uses the host's bandwidth,
 *  disk and YouTube cookies, so a ten-hour video or a live stream is refused
 *  before anything is downloaded.
 *
 *  player.py enforces the same numbers on the download itself (it reads the
 *  same env vars); this side covers the live stream the route proxies and
 *  turns the helper's refusal into a clear answer.
 *
 *  EMBER_MAX_TRACK_MINUTES  default 20
 *  EMBER_MAX_DOWNLOAD_MB    default 60 (a 20-minute m4a is about 20 MB) */

export interface MediaLimits {
  maxSec: number;
  maxBytes: number;
}

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function mediaLimits(env: Record<string, string | undefined> = process.env): MediaLimits {
  return {
    maxSec: Math.round(positive(env.EMBER_MAX_TRACK_MINUTES, 20) * 60),
    maxBytes: Math.round(positive(env.EMBER_MAX_DOWNLOAD_MB, 60) * 1024 * 1024),
  };
}

/** What yt-dlp says about a video before it is fetched. */
export interface MediaFacts {
  durationSec?: number | null;
  filesize?: number | null;
  isLive?: boolean | null;
}

/** A sentence saying why this video is refused, or null when it is fine.
 *  Starts with "too long" / "too large", which is how the error is told apart
 *  from other helper failures (isTooLargeMessage). Unknown facts pass: the
 *  download itself is capped by size too. */
export function exceedsMediaLimits(facts: MediaFacts, limits: MediaLimits = mediaLimits()): string | null {
  if (facts.isLive) return 'too long: live streams cannot be played';
  const sec = Number(facts.durationSec);
  if (Number.isFinite(sec) && sec > limits.maxSec) {
    return `too long: ${Math.ceil(sec / 60)} min is over the ${Math.round(limits.maxSec / 60)} min limit`;
  }
  const bytes = Number(facts.filesize);
  if (Number.isFinite(bytes) && bytes > limits.maxBytes) {
    return `too large: ${Math.ceil(bytes / 1048576)} MB is over the ${Math.round(limits.maxBytes / 1048576)} MB limit`;
  }
  return null;
}

export function isTooLargeMessage(message: string): boolean {
  return /^too (long|large)\b/i.test(message.trim());
}

/** 413 with the reason, for any route that refuses a video for its size. */
export function tooLargeResponse(message: string): Response {
  return Response.json(
    { error: `This video is too long to play on Ember (${message.replace(/^too (long|large):\s*/i, '')}).`, cause: 'too-long' },
    { status: 413 },
  );
}
