import 'server-only';
import { createRadioBrowser, type RadioBrowser, type RawStation } from '@/lib/radio/radioBrowser';
import { isStationId, stationTrack, type RadioStation } from '@/lib/radio/station';

/** The radio lists the routes serve, cached here for hours: Radio Browser is
 *  run by volunteers and asks apps not to hammer it, and a station list
 *  changes slowly. Every station seen is also remembered by id with its
 *  stream address, which is the only place the stream proxy takes an address
 *  from (it is never told one by a client). */

/** How long a list is served from memory. */
export const LIST_TTL_MS = 3 * 60 * 60_000;
/** How long a station's stream address is trusted without asking again. */
export const STATION_TTL_MS = 12 * 60 * 60_000;
/** How long an id Radio Browser did not know is not asked about again. */
export const MISS_TTL_MS = 10 * 60_000;
const MAX_LISTS = 300;
const MAX_STATIONS = 5_000;
/** Radius of the Nearby list, metres (Radio Browser's geo_distance). */
export const NEARBY_RADIUS_M = 200_000;
const LIST_LIMIT = '100';
const SEARCH_LIMIT = '50';
export const SEARCH_MAX_CHARS = 80;

/** What browsers and Android's player decode from a plain HTTP stream. HLS
 *  playlists are left out (the proxy streams bytes, it does not rewrite
 *  playlists), and so is anything Radio Browser could not identify. */
const PLAYABLE_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'OPUS']);

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** ~0.1 degree (about 10 km): enough for "near me", too coarse to say where
 *  someone lives, and it lets everyone in a town share one cached list. */
export function roundCoord(v: number): number {
  return Math.round(v * 10) / 10;
}

function httpUrl(raw: unknown): string | null {
  const s = str(raw, 2_000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Radio Browser's station as this app's, with its stream address; null for
 *  one that cannot play here (offline at the last check, HLS, a codec a
 *  player may not decode, no usable address). */
export function toStation(raw: RawStation): { station: RadioStation; url: string } | null {
  const id = str(raw.stationuuid, 64);
  const name = str(raw.name, 120);
  const url = httpUrl(raw.url_resolved);
  const codec = str(raw.codec, 16).toUpperCase();
  if (!isStationId(id) || !name || !url) return null;
  if (num(raw.lastcheckok) !== 1 || num(raw.hls) === 1 || !PLAYABLE_CODECS.has(codec)) return null;
  const icon = httpUrl(raw.favicon);
  const favicon = icon && icon.startsWith('https:') && icon.length <= 500 ? icon : null;
  const country = str(raw.country, 80);
  const state = str(raw.state, 80);
  const metres = raw.geo_distance === undefined || raw.geo_distance === null ? null : num(raw.geo_distance);
  const base = {
    id: id.toLowerCase(),
    name,
    favicon,
    country,
    countryCode: str(raw.countrycode, 2).toUpperCase(),
    state,
    codec,
    bitrate: Math.max(0, Math.round(num(raw.bitrate))),
    votes: Math.max(0, Math.round(num(raw.votes))),
    distanceKm: metres === null ? null : Math.round(metres / 100) / 10,
  };
  return { station: { ...base, track: stationTrack(base) }, url };
}

export interface RadioService {
  nearby(lat: number, lng: number): Promise<RadioStation[]>;
  country(code: string): Promise<RadioStation[]>;
  search(q: string): Promise<RadioStation[]>;
  /** One station by id, null when Radio Browser does not know it (or it
   *  cannot play here). */
  station(id: string): Promise<RadioStation | null>;
  /** A station already in memory, without asking anyone. */
  peek(id: string): RadioStation | null;
  /** The stream address (and codec) of a station Radio Browser listed,
   *  null otherwise. */
  streamTarget(id: string): Promise<{ url: string; codec: string } | null>;
}

export function createRadioService(deps: { browser?: RadioBrowser; now?: () => number } = {}): RadioService {
  const browser = deps.browser ?? createRadioBrowser();
  const now = deps.now ?? Date.now;
  const lists = new Map<string, { at: number; stations: RadioStation[] }>();
  const inflight = new Map<string, Promise<RadioStation[]>>();
  const known = new Map<string, { at: number; url: string; station: RadioStation }>();
  const misses = new Map<string, number>();

  /** Oldest out first (a Map keeps insertion order; a refresh re-inserts). */
  function cap<V>(map: Map<string, V>, max: number) {
    while (map.size > max) map.delete(map.keys().next().value as string);
  }

  function remember(raws: RawStation[]): RadioStation[] {
    const out: RadioStation[] = [];
    const seen = new Set<string>();
    for (const raw of raws) {
      const r = toStation(raw);
      if (!r || seen.has(r.station.id)) continue;
      seen.add(r.station.id);
      known.delete(r.station.id);
      known.set(r.station.id, { at: now(), url: r.url, station: r.station });
      out.push(r.station);
    }
    cap(known, MAX_STATIONS);
    return out;
  }

  function list(key: string, load: () => Promise<RawStation[]>, order?: (a: RadioStation, b: RadioStation) => number) {
    const hit = lists.get(key);
    if (hit && now() - hit.at < LIST_TTL_MS) return Promise.resolve(hit.stations);
    const running = inflight.get(key);
    if (running) return running;
    const p = load()
      .then((raws) => {
        const stations = remember(raws);
        if (order) stations.sort(order);
        lists.delete(key);
        lists.set(key, { at: now(), stations });
        cap(lists, MAX_LISTS);
        return stations;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function lookup(id: string) {
    const key = id.toLowerCase();
    const hit = known.get(key);
    if (hit && now() - hit.at < STATION_TTL_MS) return hit;
    const missed = misses.get(key);
    if (missed !== undefined && now() - missed < MISS_TTL_MS) return null;
    remember(await browser.byUuid([key]));
    const found = known.get(key);
    if (found && now() - found.at < STATION_TTL_MS) return found;
    misses.set(key, now());
    cap(misses, MAX_STATIONS);
    return null;
  }

  return {
    nearby(lat, lng) {
      const la = roundCoord(lat);
      const lo = roundCoord(lng);
      return list(
        `near:${la.toFixed(1)},${lo.toFixed(1)}`,
        () => browser.search({
          geo_lat: la.toFixed(1),
          geo_long: lo.toFixed(1),
          geo_distance: String(NEARBY_RADIUS_M),
          has_geo_info: 'true',
          hidebroken: 'true',
          order: 'votes',
          reverse: 'true',
          limit: LIST_LIMIT,
        }),
        // Radio Browser has no "order by distance": it filters by the
        // radius, and the nearest come first here.
        (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || b.votes - a.votes,
      );
    },
    country(code) {
      const cc = code.toUpperCase();
      return list(`country:${cc}`, () => browser.search({
        countrycode: cc,
        hidebroken: 'true',
        order: 'votes',
        reverse: 'true',
        limit: LIST_LIMIT,
      }));
    },
    search(q) {
      const query = q.trim().slice(0, SEARCH_MAX_CHARS);
      return list(`search:${query.toLowerCase()}`, () => browser.search({
        name: query,
        hidebroken: 'true',
        order: 'votes',
        reverse: 'true',
        limit: SEARCH_LIMIT,
      }));
    },
    async station(id) {
      if (!isStationId(id)) return null;
      return (await lookup(id))?.station ?? null;
    },
    peek(id) {
      const hit = isStationId(id) ? known.get(id.toLowerCase()) : undefined;
      return hit && now() - hit.at < STATION_TTL_MS ? hit.station : null;
    },
    async streamTarget(id) {
      if (!isStationId(id)) return null;
      const hit = await lookup(id);
      return hit ? { url: hit.url, codec: hit.station.codec } : null;
    },
  };
}

/** The one service the routes share (its caches are the point). */
let shared: RadioService | null = null;
export function radioService(): RadioService {
  shared ??= createRadioService();
  return shared;
}
