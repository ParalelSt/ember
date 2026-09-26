/** How long, and how big, a song the host fetches from YouTube may be. No cap
 *  by default: this host is only used by trusted friends. A live stream is
 *  still refused, not because of any cap, but because it has no end, so
 *  proxying or downloading it could never finish.
 *
 *  EMBER_MAX_TRACK_MINUTES and EMBER_MAX_DOWNLOAD_MB opt back into a cap when
 *  set to a positive number, for a host that wants one; 0 or unset (the
 *  default) means unlimited. player.py reads the same env vars and enforces
 *  the same numbers on the download itself; this side covers the live stream
 *  the route proxies and turns the helper's refusal into a clear answer.
 *
 *  (security audit 2026-09-25, M2; cap removed 2026-09-26 at the owner's
 *  request.) */

export interface MediaLimits {
  /** Seconds, or 0 for unlimited. */
  maxSec: number;
  /** Bytes, or 0 for unlimited. */
  maxBytes: number;
}

function optIn(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function mediaLimits(env: Record<string, string | undefined> = process.env): MediaLimits {
  return {
    maxSec: Math.round(optIn(env.EMBER_MAX_TRACK_MINUTES) * 60),
    maxBytes: Math.round(optIn(env.EMBER_MAX_DOWNLOAD_MB) * 1024 * 1024),
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
 *  from other helper failures (isTooLargeMessage). A live stream is always
 *  refused (it can never finish); the length/size checks only run when the
 *  matching limit is set (opt-in). Unknown facts pass. */
export function exceedsMediaLimits(facts: MediaFacts, limits: MediaLimits = mediaLimits()): string | null {
  if (facts.isLive) return 'too long: live streams cannot be played';
  const sec = Number(facts.durationSec);
  if (limits.maxSec && Number.isFinite(sec) && sec > limits.maxSec) {
    return `too long: ${Math.ceil(sec / 60)} min is over the ${Math.round(limits.maxSec / 60)} min limit`;
  }
  const bytes = Number(facts.filesize);
  if (limits.maxBytes && Number.isFinite(bytes) && bytes > limits.maxBytes) {
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
