import { z } from 'zod';
import { scrubText } from '@/lib/logger/sanitize';
import { PERF_OSES } from './os';
import { routeShape } from './route';
import type { PerfDigest } from './types';

/** What POST /api/perf-log accepts: the page's digest (lib/perf/digest.ts),
 *  checked field by field. Unknown fields are refused, numbers are bounded,
 *  and the few strings are short, shaped (routes) and scrubbed again here. */

export const PERF_LOG_LIMITS = {
  /** A batch is at most 6 KB; the slack is for the request's own framing. */
  maxBodyBytes: 8192,
  /** Uploads per member per hour, over all their devices (a page sends at
   *  most 20 an hour, lib/perf/client.ts). */
  rate: { windowMs: 60 * 60 * 1000, max: 60 },
} as const;

const ms = z.number().finite().min(0).max(10_000_000);
const count = z.number().int().min(0).max(1_000_000);
const short = (n: number) => z.string().max(n);

const LaunchSchema = z
  .object({
    ttfb: ms.optional(),
    domReady: ms.optional(),
    fcp: ms.optional(),
    hydrated: ms.optional(),
    idle: ms.optional(),
    scripts: count.optional(),
    scriptKb: count.optional(),
    cached: count.optional(),
    proto: short(16).optional(),
  })
  .strict();

const label = short(60);

const EventSchema = z.discriminatedUnion('k', [
  z
    .object({
      k: z.literal('nav'),
      at: ms,
      to: short(120),
      via: z.enum(['tap', 'pop', 'push']),
      ms: ms.optional(),
      server: ms.optional(),
      commit: ms.optional(),
      lt: ms,
      playing: z.boolean().optional(),
      abandoned: z.boolean().optional(),
      area: z.enum(['sidebar', 'drawer', 'bottom']).optional(),
    })
    .strict(),
  z.object({ k: z.literal('freeze'), at: ms, ms }).strict(),
  z
    .object({ k: z.literal('rage'), at: ms, target: label, taps: count, pending: ms.optional(), overlay: z.boolean(), inert: z.boolean() })
    .strict(),
  z.object({ k: z.literal('slow'), at: ms, type: short(30), ms, target: label.optional() }).strict(),
]);

export const PerfDigestSchema = z
  .object({
    v: z.literal(1),
    session: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
    seq: z.number().int().min(1).max(100_000),
    /** The page's start, ms since 1970: from 2020 to 2100. */
    t0: z.number().int().min(1_577_836_800_000).max(4_102_444_800_000),
    app: short(40),
    shell: short(20),
    /** Optional: batches from apps older than the field have none. */
    os: z.enum(PERF_OSES).optional(),
    device: z
      .object({
        mem: z.number().min(0).max(1024).optional(),
        cores: count.optional(),
        model: short(40).optional(),
        net: short(10).optional(),
      })
      .strict(),
    fgMs: ms,
    launch: LaunchSchema.optional(),
    lt: z
      .object({ n: count, ms, max: ms, top: z.array(z.tuple([short(60), ms])).max(5).optional() })
      .strict()
      .optional(),
    nav: z
      .object({
        n: count,
        ms: z.array(ms).max(20),
        worst: z
          .array(z.object({ to: short(120), ms, server: ms.optional(), commit: ms.optional() }).strict())
          .max(2)
          .optional(),
      })
      .strict()
      .optional(),
    slow: z.object({ n: count, max: ms }).strict().optional(),
    freeze: z.object({ n: count, max: ms }).strict().optional(),
    rage: count.optional(),
    heap: z.object({ used: z.number().min(0).max(100_000), limit: z.number().min(0).max(100_000).optional() }).strict().optional(),
    dom: count.optional(),
    api: z.array(z.tuple([short(120), count, ms, ms])).max(5).optional(),
    ev: z.array(EventSchema).max(60).optional(),
    evDropped: count.optional(),
  })
  .strict();

/** A tap target label: names the code gave it, with a link's path shaped
 *  again here. */
function cleanLabel(s: string): string {
  return s.startsWith('link ') ? `link ${routeShape(s.slice(5))}` : scrubText(s);
}

/** The digest as it is stored: routes reshaped (no id gets through even
 *  from a hand-made client) and free text scrubbed. */
export function cleanDigest(d: z.infer<typeof PerfDigestSchema>): PerfDigest {
  const out: PerfDigest = { ...d, app: scrubText(d.app), shell: scrubText(d.shell), device: { ...d.device } };
  if (d.device.model) out.device.model = scrubText(d.device.model);
  if (d.lt?.top) out.lt = { ...d.lt, top: d.lt.top.map(([s, n]) => [scrubText(s), n]) };
  if (d.nav?.worst) out.nav = { ...d.nav, worst: d.nav.worst.map((w) => ({ ...w, to: routeShape(w.to) })) };
  if (d.api) out.api = d.api.map(([r, n, p50, max]) => [routeShape(r), n, p50, max]);
  if (d.ev) {
    out.ev = d.ev.map((e) => {
      if (e.k === 'nav') return { ...e, to: routeShape(e.to) };
      if (e.k === 'rage') return { ...e, target: cleanLabel(e.target) };
      if (e.k === 'slow') return e.target ? { ...e, target: cleanLabel(e.target) } : e;
      return e;
    });
  }
  return out;
}

/** The body as text, read chunk by chunk and given up (null) as soon as it
 *  passes `max` bytes: a body without a Content-Length (chunked) is never
 *  held whole in memory. */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
