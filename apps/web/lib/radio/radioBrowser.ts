import 'server-only';
import { promises as dns } from 'node:dns';

/** The Radio Browser API (https://api.radio-browser.info), free and keyless,
 *  run by volunteers. Its etiquette, which this follows: find the servers
 *  through DNS (never hard-code one), try them in a random order and move to
 *  the next when one fails, and send a User-Agent that names the app. The
 *  answers are cached by the caller (lib/radio/service) for hours, so a
 *  listener browsing never reaches Radio Browser more than once per list. */

/** One station as Radio Browser lists it (the fields this app reads). */
export interface RawStation {
  stationuuid?: unknown;
  name?: unknown;
  url_resolved?: unknown;
  favicon?: unknown;
  country?: unknown;
  countrycode?: unknown;
  state?: unknown;
  codec?: unknown;
  bitrate?: unknown;
  votes?: unknown;
  hls?: unknown;
  lastcheckok?: unknown;
  geo_lat?: unknown;
  geo_long?: unknown;
  /** Metres from the request's geo_lat/geo_long, only when both are given. */
  geo_distance?: unknown;
}

export interface RadioBrowser {
  /** /json/stations/search with these parameters (names as documented). */
  search(params: Record<string, string>): Promise<RawStation[]>;
  /** /json/stations/byuuid. */
  byUuid(ids: string[]): Promise<RawStation[]>;
}

export interface RadioBrowserDeps {
  fetch?: typeof fetch;
  /** Host names of the API servers. */
  servers?: () => Promise<string[]>;
  now?: () => number;
  userAgent?: string;
  /** Per request, headers and body. */
  timeoutMs?: number;
}

/** How long a server list is used before DNS is asked again. */
export const SERVER_LIST_TTL_MS = 60 * 60_000;
/** Servers tried for one request before it fails. */
const MAX_TRIES = 3;
const DEFAULT_TIMEOUT_MS = 8_000;
const HOST_RE = /^[a-z0-9.-]+\.radio-browser\.info$/i;

export function radioUserAgent(): string {
  const version = (process.env.NEXT_PUBLIC_APP_VERSION ?? '').split(' ')[0] || 'dev';
  return `Ember/${version}`;
}

/** The API servers, as the docs say to find them: the DNS SRV record, then
 *  the list one of them publishes, then the round-robin name itself. */
export async function discoverServers(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    const srv = await dns.resolveSrv('_api._tcp.radio-browser.info');
    const names = srv.map((r) => r.name).filter((n) => HOST_RE.test(n));
    if (names.length) return names;
  } catch {
    // No SRV answer: fall through to the published list.
  }
  try {
    const res = await fetchImpl('https://all.api.radio-browser.info/json/servers', {
      headers: { 'User-Agent': radioUserAgent() },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (res.ok) {
      const list = (await res.json()) as { name?: unknown }[];
      const names = [...new Set(list.map((s) => (typeof s?.name === 'string' ? s.name : '')).filter((n) => HOST_RE.test(n)))];
      if (names.length) return names;
    }
  } catch {
    // Fall through.
  }
  return ['all.api.radio-browser.info'];
}

function shuffled<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createRadioBrowser(deps: RadioBrowserDeps = {}): RadioBrowser {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const servers = deps.servers ?? (() => discoverServers(fetchImpl));
  let list: { names: string[]; at: number } | null = null;
  let pending: Promise<string[]> | null = null;

  async function serverNames(): Promise<string[]> {
    if (list && now() - list.at < SERVER_LIST_TTL_MS) return list.names;
    pending ??= servers()
      .then((names) => {
        list = { names: names.length ? names : ['all.api.radio-browser.info'], at: now() };
        return list.names;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  async function get(path: string, params: Record<string, string>): Promise<RawStation[]> {
    const query = new URLSearchParams(params).toString();
    const hosts = shuffled(await serverNames()).slice(0, MAX_TRIES);
    let last: unknown = null;
    for (const host of hosts) {
      try {
        const res = await fetchImpl(`https://${host}${path}${query ? `?${query}` : ''}`, {
          headers: { 'User-Agent': deps.userAgent ?? radioUserAgent(), Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`${host} answered ${res.status}`);
        const body: unknown = await res.json();
        if (!Array.isArray(body)) throw new Error(`${host} sent no list`);
        return body as RawStation[];
      } catch (e) {
        last = e;
      }
    }
    // Every server failed: the next request looks the servers up again.
    list = null;
    throw Object.assign(new Error(`Radio Browser could not be reached (${last instanceof Error ? last.message : 'no answer'})`), { status: 502 });
  }

  return {
    search: (params) => get('/json/stations/search', params),
    byUuid: (ids) => get('/json/stations/byuuid', { uuids: ids.join(',') }),
  };
}
