import 'server-only';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

/** Fetching a radio station's stream for the host's proxy route.
 *
 *  Station addresses come from Radio Browser, which anyone can add stations
 *  to, so one may well point at this host's own network (PocketBase on
 *  127.0.0.1, a router, a NAS). The proxy would then hand a member whatever
 *  answered. So every connection, including each redirect hop, is checked
 *  against the address it ACTUALLY connects to (the DNS answer, not the
 *  name), and anything that is not a public internet address is refused. */

export class StreamRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamRefusedError';
  }
}

function v4(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) ? parts : null;
}

/** Whether `ip` is a public unicast address (not loopback, private, link
 *  local, carrier NAT, multicast, documentation or otherwise reserved). */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const [a, b] = v4(ip)!;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false;
    return true;
  }
  if (family === 6) {
    const s = ip.toLowerCase();
    // An IPv4 address carried in IPv6 is judged as itself.
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s) ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicAddress(mapped[1]);
    if (s === '::' || s === '::1') return false;
    const first = parseInt(s.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (s.startsWith('2001:db8') || s.startsWith('64:ff9b')) return false;
    return true;
  }
  return false;
}

export interface UpstreamOptions {
  userAgent: string;
  /** Aborts the request (and a body already streaming). */
  signal?: AbortSignal;
  /** Until the response's headers arrive. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tests only: which addresses may be connected to. */
  allowAddress?: (ip: string) => boolean;
}

export interface Upstream {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: http.IncomingMessage;
  /** Ends the connection. */
  close: () => void;
}

function guardedLookup(allow: (ip: string) => boolean): LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const ok = (addresses as dns.LookupAddress[]).filter((a) => allow(a.address));
      if (!ok.length) return callback(Object.assign(new StreamRefusedError(`${hostname} is not a public address`), { code: 'EREFUSED' }));
      if (options.all) callback(null, ok);
      else callback(null, ok[0].address, ok[0].family);
    });
  }) as LookupFunction;
}

/** GET a station stream: http or https, a public address only (every hop),
 *  no credentials in the address, at most `maxRedirects` redirects. Resolves
 *  once the final response's headers are in; the caller reads (and closes)
 *  the body. Sends no Icy-MetaData header, so the station sends plain audio
 *  with no song titles woven into it. */
export function openUpstream(rawUrl: string, opts: UpstreamOptions): Promise<Upstream> {
  const allow = opts.allowAddress ?? isPublicAddress;
  const maxRedirects = opts.maxRedirects ?? 3;
  const timeoutMs = opts.timeoutMs ?? 8_000;

  const attempt = (address: string, hops: number): Promise<Upstream> => new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      reject(new StreamRefusedError('not a valid address'));
      return;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      reject(new StreamRefusedError('only plain http and https streams'));
      return;
    }
    // An address given as an IP never goes through the lookup.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !allow(host)) {
      reject(new StreamRefusedError(`${host} is not a public address`));
      return;
    }
    if (opts.signal?.aborted) {
      reject(new StreamRefusedError('cancelled'));
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      headers: { 'User-Agent': opts.userAgent, Accept: '*/*' },
      lookup: guardedLookup(allow),
      // A fresh connection per stream: one that outlives its listener must
      // never serve the next station's request.
      agent: false,
    });
    const timer = setTimeout(() => req.destroy(new Error(`the station sent no answer in ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    const onAbort = () => req.destroy(new StreamRefusedError('cancelled'));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (e) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    req.on('response', (res) => {
      clearTimeout(timer);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        req.destroy();
        opts.signal?.removeEventListener('abort', onAbort);
        if (hops >= maxRedirects) {
          reject(new StreamRefusedError('too many redirects'));
          return;
        }
        let next: string;
        try {
          next = new URL(location, url).toString();
        } catch {
          reject(new StreamRefusedError('a redirect to an invalid address'));
          return;
        }
        attempt(next, hops + 1).then(resolve, reject);
        return;
      }
      const close = () => {
        opts.signal?.removeEventListener('abort', onAbort);
        res.destroy();
        req.destroy();
      };
      res.once('close', () => opts.signal?.removeEventListener('abort', onAbort));
      resolve({ status, headers: res.headers, body: res, close });
    });
    req.end();
  });

  return attempt(rawUrl, 0);
}

const TYPE_BY_CODEC: Record<string, string> = {
  MP3: 'audio/mpeg',
  AAC: 'audio/aac',
  'AAC+': 'audio/aac',
  OGG: 'audio/ogg',
  OPUS: 'audio/ogg',
};

/** A content type a player can take as audio. Anything else (an HTML page
 *  where the stream used to be) is not passed on. A stream labelled with
 *  no type, or a generic one, gets the type of the codec Radio Browser
 *  measured for it. */
export function audioContentType(raw: string | string[] | undefined, codec = ''): string | null {
  const type = (Array.isArray(raw) ? raw[0] : raw)?.split(';')[0].trim().toLowerCase() ?? '';
  if (type.startsWith('audio/') || type === 'application/ogg') return type;
  if (type === 'application/octet-stream' || type === '') return TYPE_BY_CODEC[codec.toUpperCase()] ?? 'audio/mpeg';
  return null;
}

/** Streams open at once, per member and in all. A member's new stream ends
 *  their oldest beyond the per-member cap (one listener switching stations,
 *  or a player that has not let go of the last one yet); past the host's
 *  total a new stream is refused. */
export interface StreamSlots {
  /** null when the host is at its total. `close` ends that stream (called
   *  when the slot is taken over); the returned `release` frees the slot. */
  acquire(userId: string, close: () => void): { release: () => void } | null;
  count(userId?: string): number;
}

export function createStreamSlots(perUser = 2, total = 40): StreamSlots {
  const open: { userId: string; close: () => void; released: boolean }[] = [];
  return {
    acquire(userId, close) {
      const mine = open.filter((s) => s.userId === userId);
      while (mine.length >= perUser) {
        const oldest = mine.shift()!;
        oldest.released = true;
        open.splice(open.indexOf(oldest), 1);
        try { oldest.close(); } catch { /* already gone */ }
      }
      if (open.length >= total) return null;
      const slot = { userId, close, released: false };
      open.push(slot);
      return {
        release() {
          if (slot.released) return;
          slot.released = true;
          const i = open.indexOf(slot);
          if (i >= 0) open.splice(i, 1);
        },
      };
    },
    count(userId) {
      return userId ? open.filter((s) => s.userId === userId).length : open.length;
    },
  };
}

let sharedSlots: StreamSlots | null = null;
export function streamSlots(): StreamSlots {
  sharedSlots ??= createStreamSlots();
  return sharedSlots;
}
