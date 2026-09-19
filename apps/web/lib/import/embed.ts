/** Read a Spotify playlist from its public embed page
 *  (`open.spotify.com/embed/playlist/<id>`).
 *
 *  Since Spotify's February 2026 Web API change, an app with client
 *  credentials can no longer read the tracks of a playlist it does not own.
 *  The embed page still ships the playlist as JSON in its `__NEXT_DATA__`
 *  script: name, cover, and per track the title, artists, length and explicit
 *  flag. It lists the first 100 tracks only and is not an official API, so
 *  this parser is strict about what it needs and says clearly when the shape
 *  has changed. Pure: unit tested against a saved page in
 *  tests/fixtures/imports/. */

/** Spotify's embed page never lists more than this many tracks. */
export const SPOTIFY_EMBED_LIMIT = 100;

/** One track as the source playlist has it. Kept for every item, accepted or
 *  not, so a match can be re-picked later. */
export interface SourceItem {
  /** 0-based position in the source playlist. */
  position: number;
  title: string;
  /** Artist names. Spotify joins them with a comma and a NO-BREAK space,
   *  while a band name with a comma in it ("Earth, Wind & Fire") has a plain
   *  space, so the split is exact. */
  artists: string[];
  /** The artist line as Spotify shows it, with plain spaces. */
  artist: string;
  durationMs: number | null;
  explicit: boolean | null;
  /** `spotify:track:<id>`. */
  uri: string | null;
}

export interface EmbedPlaylist {
  id: string;
  name: string;
  coverUrl: string | null;
  items: SourceItem[];
  /** The page listed exactly the cap, so the playlist may be longer. */
  mayBeTruncated: boolean;
}

export type EmbedErrorKind = 'not-found' | 'unreadable';

export class EmbedError extends Error {
  kind: EmbedErrorKind;
  constructor(kind: EmbedErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'EmbedError';
  }
}

interface RawEmbedTrack {
  uri?: unknown;
  title?: unknown;
  subtitle?: unknown;
  duration?: unknown;
  isExplicit?: unknown;
  entityType?: unknown;
}

interface RawEntity {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  title?: unknown;
  coverArt?: { sources?: { url?: unknown; width?: unknown }[] } | null;
  trackList?: unknown;
}

const NEXT_DATA_RE = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function pickCover(entity: RawEntity): string | null {
  const sources = entity.coverArt?.sources ?? [];
  const urls = sources
    .map((s) => ({ url: str(s?.url), width: typeof s?.width === 'number' ? s.width : 0 }))
    .filter((s) => s.url.startsWith('https://'));
  if (!urls.length) return null;
  urls.sort((a, b) => b.width - a.width);
  return urls[0].url;
}

/** Split Spotify's artist line on its separator, comma + U+00A0. */
export function splitArtists(line: string): string[] {
  return line
    .split(',\u00a0')
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Parse an embed page's HTML. Throws EmbedError('not-found') when Spotify
 *  served its "Page not found" state (unknown or private playlist), and
 *  EmbedError('unreadable') when the page no longer has the expected shape. */
export function parseEmbedPage(html: string): EmbedPlaylist {
  const m = NEXT_DATA_RE.exec(html);
  if (!m) throw new EmbedError('unreadable', 'embed page has no __NEXT_DATA__ script');
  let data: { props?: { pageProps?: { status?: unknown; state?: { data?: { entity?: RawEntity } } } } };
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new EmbedError('unreadable', 'embed page __NEXT_DATA__ is not JSON');
  }
  const pageProps = data?.props?.pageProps;
  if (pageProps?.status === 404) throw new EmbedError('not-found', 'playlist not found');
  const entity = pageProps?.state?.data?.entity;
  if (!entity) throw new EmbedError('unreadable', 'embed page has no entity');
  if (entity.type !== 'playlist') throw new EmbedError('not-found', `embed entity is a ${str(entity.type) || 'unknown'}`);
  if (!Array.isArray(entity.trackList)) throw new EmbedError('unreadable', 'embed entity has no trackList');

  const rawTracks = entity.trackList as RawEmbedTrack[];
  const items: SourceItem[] = [];
  rawTracks.forEach((t, position) => {
    const title = str(t?.title).trim();
    const uri = str(t?.uri) || null;
    // Podcast episodes and local files cannot be matched onto YouTube Music.
    if (!title) return;
    if (t.entityType !== undefined && t.entityType !== 'track') return;
    if (uri && !uri.startsWith('spotify:track:')) return;
    const line = str(t.subtitle).trim();
    items.push({
      position,
      title,
      artists: splitArtists(line),
      artist: line.replace(/\u00a0/g, ' '),
      durationMs: typeof t.duration === 'number' && t.duration > 0 ? t.duration : null,
      explicit: typeof t.isExplicit === 'boolean' ? t.isExplicit : null,
      uri,
    });
  });

  return {
    id: str(entity.id),
    name: str(entity.name).trim() || str(entity.title).trim() || 'Imported playlist',
    coverUrl: pickCover(entity),
    items,
    mayBeTruncated: rawTracks.length >= SPOTIFY_EMBED_LIMIT,
  };
}
