import 'server-only';
import { openUpstream, StreamRefusedError } from '@/lib/radio/streamProxy';

/** Fetching a station's logo for the host's logo route (app/api/radio/logo),
 *  so the page can read its pixels (a logo from another site taints the
 *  canvas). The address is always the one Radio Browser listed for the
 *  station, and it goes through the stream proxy's guarded connection: a
 *  public internet address only, on every redirect hop. Only a raster image
 *  (PNG, JPEG, GIF, WebP, ICO, BMP, AVIF) of at most LOGO_MAX_BYTES comes
 *  back, typed by its own bytes; never SVG (it can carry script) or a page. */

/** Station logos are favicons and small banners; anything bigger is not
 *  one. */
export const LOGO_MAX_BYTES = 512 * 1024;
/** The whole fetch, headers and body. */
export const LOGO_TIMEOUT_MS = 6_000;

export class LogoRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogoRefusedError';
  }
}

/** The raster type of `bytes` by their first few bytes, null for anything
 *  else. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const at = (i: number, ...want: number[]) => want.every((v, j) => bytes[i + j] === v);
  const ascii = (i: number, s: string) => at(i, ...Array.from(s, (c) => c.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (at(0, 0x00, 0x00, 0x01, 0x00) && bytes.length >= 6) return 'image/x-icon';
  if (ascii(0, 'BM') && bytes.length >= 26) return 'image/bmp';
  if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'image/avif';
  return null;
}

/** Whether the type the site sent may be a logo: an image other than SVG,
 *  or no type to speak of (many favicon hosts send octet-stream). The bytes
 *  decide in the end. */
export function acceptableLogoType(raw: string | string[] | undefined): boolean {
  const type = (Array.isArray(raw) ? raw[0] : raw)?.split(';')[0].trim().toLowerCase() ?? '';
  if (type === '' || type === 'application/octet-stream') return true;
  return type.startsWith('image/') && !type.includes('svg');
}

export interface FetchLogoOptions {
  userAgent: string;
  /** Tests only: which addresses may be connected to. */
  allowAddress?: (ip: string) => boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

/** GET a logo: `{ type, bytes }`, or a LogoRefusedError (StreamRefusedError
 *  for an address that is not public) for anything that is not a small
 *  raster image answered in time. */
export async function fetchLogo(url: string, opts: FetchLogoOptions): Promise<{ type: string; bytes: Buffer }> {
  const maxBytes = opts.maxBytes ?? LOGO_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? LOGO_TIMEOUT_MS;
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const upstream = await openUpstream(url, {
      userAgent: opts.userAgent,
      signal: control.signal,
      timeoutMs,
      maxRedirects: 3,
      allowAddress: opts.allowAddress,
    });
    try {
      if (upstream.status !== 200) throw new LogoRefusedError(`the logo answered ${upstream.status}`);
      if (!acceptableLogoType(upstream.headers['content-type'])) throw new LogoRefusedError('not an image');
      const declared = Number(upstream.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) throw new LogoRefusedError('the logo is too big');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of upstream.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buf.length;
        if (size > maxBytes) throw new LogoRefusedError('the logo is too big');
        chunks.push(buf);
      }
      if (control.signal.aborted) throw new LogoRefusedError('the logo took too long');
      const bytes = Buffer.concat(chunks);
      const type = sniffImageType(bytes);
      if (!type) throw new LogoRefusedError('not a raster image');
      return { type, bytes };
    } finally {
      upstream.close();
    }
  } catch (e) {
    if (e instanceof LogoRefusedError) throw e;
    if (control.signal.aborted) throw new LogoRefusedError('the logo took too long');
    if (e instanceof StreamRefusedError) throw e;
    throw new LogoRefusedError(e instanceof Error ? e.message : 'the logo could not be fetched');
  } finally {
    clearTimeout(timer);
  }
}
