import 'server-only';
import { radioUserAgent } from '@/lib/radio/radioBrowser';
import { openUpstream } from '@/lib/radio/streamProxy';
import type { StationSong } from '@/lib/radio/station';

/** What a station is playing, read from its own stream: asked for with
 *  `Icy-MetaData: 1`, a station sends `icy-metaint` bytes of audio, then one
 *  length byte (times 16), then that much metadata, `StreamTitle='...';`.
 *  Only the first block is read, then the stream is let go. Each station is
 *  asked at most once per NOW_TTL_MS, however many listeners poll it. */

/** How long a station's answer is served from memory. */
export const NOW_TTL_MS = 25_000;
/** The whole read, from connecting to the first title. */
export const NOW_TIMEOUT_MS = 6_000;
/** Audio before the first title, at most: stations send 8 to 32 KiB. A
 *  station that says more is not read at all. */
export const MAX_METAINT = 64 * 1024;
const MAX_TEXT = 200;
const MAX_ENTRIES = 500;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/** "Artist - Title" from a metadata block's text; null when it names no
 *  song. An apostrophe in a name ("Guns N' Roses") is not the end. */
export function parseStreamTitle(meta: string): StationSong | null {
  const m = /StreamTitle='([\s\S]*?)';(?=\s*(?:[A-Za-z_]+='|$))/.exec(meta.replace(/\0+$/, ''));
  const line = clean(m?.[1] ?? '');
  if (!line || /^[-\s]*$/.test(line)) return null;
  const cut = line.indexOf(' - ');
  const artist = cut > 0 ? clean(line.slice(0, cut)) : '';
  const title = cut > 0 ? clean(line.slice(cut + 3)) : '';
  return artist && title ? { artist, title } : { artist: null, title: line };
}

/** UTF-8 where it is valid, Latin-1 otherwise (older stations). */
export function decodeMetadata(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('latin1').decode(buf);
  }
}

/** The first metadata block of a stream that weaves one in every `metaint`
 *  bytes; null for an empty one or a stream that ends first. Reads at most
 *  metaint + 1 + 4080 bytes. */
export async function readFirstMetadata(body: AsyncIterable<Uint8Array>, metaint: number): Promise<Uint8Array | null> {
  let skip = metaint;
  let length = -1;
  const parts: Uint8Array[] = [];
  let have = 0;
  for await (const chunk of body) {
    let buf = chunk;
    if (skip > 0) {
      if (buf.length <= skip) {
        skip -= buf.length;
        continue;
      }
      buf = buf.subarray(skip);
      skip = 0;
    }
    if (length < 0) {
      length = buf[0] * 16;
      if (length === 0) return null;
      buf = buf.subarray(1);
    }
    parts.push(buf);
    have += buf.length;
    if (have >= length) return Buffer.concat(parts).subarray(0, length);
  }
  return null;
}

export interface NowPlayingDeps {
  open?: typeof openUpstream;
  now?: () => number;
  timeoutMs?: number;
}

export interface NowPlaying {
  /** The song on station `id`, whose stream is at `url` (only ever the
   *  address Radio Browser listed: lib/radio/service streamTarget). null when
   *  the station names none, sends no titles, or does not answer in time. */
  song(id: string, url: string): Promise<StationSong | null>;
}

export function createNowPlaying(deps: NowPlayingDeps = {}): NowPlaying {
  const open = deps.open ?? openUpstream;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? NOW_TIMEOUT_MS;
  const cache = new Map<string, { at: number; song: StationSong | null }>();
  const inflight = new Map<string, Promise<StationSong | null>>();

  async function read(url: string): Promise<StationSong | null> {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), timeoutMs);
    let close = () => {};
    try {
      const up = await open(url, { userAgent: radioUserAgent(), signal: control.signal, timeoutMs, icyMetadata: true });
      close = up.close;
      const raw = up.headers['icy-metaint'];
      const metaint = Number(Array.isArray(raw) ? raw[0] : raw);
      if (up.status !== 200 || !Number.isInteger(metaint) || metaint <= 0 || metaint > MAX_METAINT) return null;
      const meta = await readFirstMetadata(up.body, metaint);
      return meta ? parseStreamTitle(decodeMetadata(meta)) : null;
    } catch {
      // Not answering, refused, cut off by the timeout: no song to show.
      return null;
    } finally {
      clearTimeout(timer);
      close();
    }
  }

  return {
    song(id, url) {
      const hit = cache.get(id);
      if (hit && now() - hit.at < NOW_TTL_MS) return Promise.resolve(hit.song);
      const running = inflight.get(id);
      if (running) return running;
      const p = read(url)
        .then((song) => {
          cache.delete(id);
          cache.set(id, { at: now(), song });
          while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
          return song;
        })
        .finally(() => inflight.delete(id));
      inflight.set(id, p);
      return p;
    },
  };
}

/** The one the route shares (its cache is the point). */
let shared: NowPlaying | null = null;
export function stationNowPlaying(): NowPlaying {
  shared ??= createNowPlaying();
  return shared;
}
