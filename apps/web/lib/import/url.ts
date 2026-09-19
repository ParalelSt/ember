/** Parse a pasted playlist link into an import source.
 *
 *  Supported:
 *  - open.spotify.com/playlist/<id> (also /intl-xx/playlist/<id> and
 *    /embed/playlist/<id>), spotify:playlist:<id>
 *  - spotify.link/<code> and *.app.link short links (resolved on the server,
 *    since the id only appears after the redirect)
 *  - music.youtube.com/playlist?list=<id>, youtube.com/playlist?list=<id>,
 *    and a youtube.com/watch or youtu.be link that carries a `list`
 *
 *  Pure, so the dialog and the unit tests can use it without a server. */

export type ImportLink =
  | { source: 'spotify'; id: string }
  | { source: 'spotify-short'; url: string }
  | { source: 'ytmusic'; id: string };

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;
const YT_LIST_RE = /^[A-Za-z0-9_-]{10,60}$/;

export function parseImportUrl(raw: string): ImportLink | null {
  const s = raw.trim();
  const uri = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(s);
  if (uri) return SPOTIFY_ID_RE.test(uri[1]) ? { source: 'spotify', id: uri[1] } : null;

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const m = /^(?:\/intl-[a-z-]+)?(?:\/embed)?\/playlist\/([A-Za-z0-9]+)\/?$/i.exec(url.pathname);
    return m && SPOTIFY_ID_RE.test(m[1]) ? { source: 'spotify', id: m[1] } : null;
  }
  if (host === 'spotify.link' || host === 'spotify.app.link') {
    return url.pathname.length > 1 ? { source: 'spotify-short', url: `https://${host}${url.pathname}` } : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const list = url.searchParams.get('list');
    return list && YT_LIST_RE.test(list) ? { source: 'ytmusic', id: list } : null;
  }
  return null;
}
