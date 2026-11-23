import type { PagePerf } from './core';
import type { PerfDigest } from './types';

/** The periodic digest's hard size limit (section 5.1). */
export const DIGEST_MAX_BYTES = 2048;

export interface DigestMeta {
  session: string;
  app: string;
  shell: string;
  /** Put the launch record in (the first digest of a page load only). */
  withLaunch: boolean;
}

/** One small record of what happened since the last digest. Takes the
 *  core's window, so call it only when the digest is really going out.
 *  null when there is nothing worth sending. */
export function buildDigest(perf: PagePerf, meta: DigestMeta): PerfDigest | null {
  const w = perf.takeWindow();
  const mem = perf.sampleMemory() ?? perf.memory.last();
  const block = perf.block();
  const d: PerfDigest = {
    v: 1,
    session: meta.session.slice(0, 64),
    app: meta.app.slice(0, 40),
    shell: meta.shell.slice(0, 20),
    device: block.device,
    fgMs: Math.round(w.fgMs),
  };
  if (meta.withLaunch && Object.keys(block.launch).length) d.launch = block.launch;
  if (w.lt.n) d.lt = { n: w.lt.n, ms: w.lt.ms, max: w.lt.max, ...(w.lt.top.length ? { top: w.lt.top } : {}) };
  if (w.navN) {
    d.nav = {
      n: w.navN,
      ms: w.navMs,
      worst: w.navWorst.map((r) => ({
        to: r.to,
        ms: r.total ?? 0,
        ...(r.server !== undefined ? { server: r.server } : {}),
        ...(r.commit !== undefined ? { commit: r.commit } : {}),
      })),
    };
  }
  if (w.slowN) d.slow = { n: w.slowN, max: w.slowMax };
  if (w.freezeN) d.freeze = { n: w.freezeN, max: w.freezeMax };
  if (w.rage) d.rage = w.rage;
  if (mem?.used !== undefined) d.heap = { used: mem.used, ...(mem.limit ? { limit: mem.limit } : {}) };
  if (mem) d.dom = mem.dom;
  const api = block.api.slice(0, 5).map((a) => [a.route.slice(0, 60), a.n, a.p50, a.max] as [string, number, number, number]);
  if (api.length) d.api = api;

  if (d.fgMs < 1000 && !d.launch && !d.nav && !d.lt && !d.freeze) return null;
  return fitDigest(d);
}

/** Drops the least useful parts until the digest fits DIGEST_MAX_BYTES. */
export function fitDigest(d: PerfDigest): PerfDigest {
  const size = () => new TextEncoder().encode(JSON.stringify(d)).length;
  if (size() <= DIGEST_MAX_BYTES) return d;
  const steps: (() => void)[] = [
    () => delete d.api,
    () => d.lt && delete d.lt.top,
    () => d.nav && delete d.nav.worst,
    () => d.nav && (d.nav.ms = d.nav.ms.slice(0, 5)),
    () => d.launch && delete d.launch.proto,
    () => delete d.device.model,
  ];
  for (const step of steps) {
    step();
    if (size() <= DIGEST_MAX_BYTES) return d;
  }
  return d;
}
