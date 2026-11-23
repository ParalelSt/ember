import { scrubText } from '@/lib/logger/sanitize';
import type { PerfBlock } from './types';

/** The perf block of a bug report, as the server keeps it: a plain object
 *  of numbers, booleans and short scrubbed strings, lists capped, at most
 *  24 KB. Anything else (an old client, a hand-made body) is dropped, never
 *  the whole report. */

const MAX_BYTES = 24 * 1024;
const MAX_LIST = 30;
const MAX_STRING = 120;
const MAX_DEPTH = 5;

function clean(v: unknown, depth: number): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return scrubText(v.slice(0, MAX_STRING));
  if (depth >= MAX_DEPTH || v === null || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) return v.slice(-MAX_LIST).map((x) => clean(x, depth + 1)).filter((x) => x !== undefined);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
    const c = clean(x, depth + 1);
    if (c !== undefined) out[k.slice(0, 40)] = c;
  }
  return out;
}

export function sanitizePerfBlock(raw: unknown): PerfBlock | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = clean(raw, 0) as PerfBlock;
  try {
    if (JSON.stringify(out).length > MAX_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return out;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** One line for the report's Discord embed. */
export function perfLine(p: PerfBlock): string {
  const parts: string[] = [];
  if (p.on === false) parts.push(`perf log off (${p.off ?? 'off'})`);
  const l = p.launch ?? {};
  if (typeof l.hydrated === 'number') {
    const extra = [typeof l.ttfb === 'number' ? `first byte ${sec(l.ttfb)}` : '', typeof l.fcp === 'number' ? `first paint ${sec(l.fcp)}` : '']
      .filter(Boolean)
      .join(', ');
    parts.push(`ready after ${sec(l.hydrated)}${extra ? ` (${extra})` : ''}`);
  }
  const navs = Array.isArray(p.navs) ? p.navs.filter((n) => typeof n?.total === 'number') : [];
  if (navs.length) {
    const slowest = navs.reduce((a, b) => ((b.total ?? 0) > (a.total ?? 0) ? b : a));
    parts.push(`${navs.length} navigations, slowest ${sec(slowest.total ?? 0)} to ${slowest.to}`);
  }
  if (p.longTasks?.n) parts.push(`long tasks ${p.longTasks.n} (${sec(p.longTasks.ms)})`);
  if (Array.isArray(p.freezes) && p.freezes.length) parts.push(`freezes ${p.freezes.length}`);
  if (Array.isArray(p.rage) && p.rage.length) parts.push(`rage taps ${p.rage.length}`);
  const mem = Array.isArray(p.memory) ? p.memory[p.memory.length - 1] : undefined;
  if (typeof mem?.used === 'number') parts.push(`heap ${mem.used} MB`);
  return parts.join(', ') || 'no perf numbers yet';
}
