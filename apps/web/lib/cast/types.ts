/** What POST /api/cast/sign answers: links a cast device can play without
 *  the listener's cookie (server side: lib/streamToken). Shared by the route
 *  and the web client. */
export interface CastItem {
  /** Absolute, on the host's public origin, with the signed link. */
  streamUrl: string;
  /** An upload's cover, signed the same way; null for every other track
   *  (a YouTube cover is already public on Google's hosts). */
  artworkUrl: string | null;
  contentType: string;
}

export interface CastSignResponse {
  /** The host's public origin, for anything relative the client still has. */
  origin: string;
  /** Unix seconds; every link in `items` dies then. */
  expiresAt: number;
  items: Record<string, CastItem>;
}
