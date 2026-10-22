/** Cover art the browser can't read pixels from (YouTube's image hosts send
 *  no CORS header, so a canvas that draws them is "tainted"). The playlist
 *  header's color band samples them through /api/art instead. Only these
 *  image hosts, only https, so the route can't be used to fetch anything
 *  else. */
const ART_HOSTS = ['ytimg.com', 'googleusercontent.com', 'ggpht.com'];

/** The URL to fetch, or null when it isn't an allowed cover image. */
export function artProxyTarget(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  return ART_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? url : null;
}

/** Same-origin address for a cover: proxied when it's on an allowed remote
 *  host, unchanged when it's already ours (a relative path). Null when the
 *  pixels can't be read either way. */
export function readableArtUrl(src: string): string | null {
  if (src.startsWith('/')) return src;
  return artProxyTarget(src) ? `/api/art?url=${encodeURIComponent(src)}` : null;
}

/** Covers are small; anything bigger isn't a cover. */
export const ART_MAX_BYTES = 2 * 1024 * 1024;
