import type { PagePerf, PendingEvent } from './core';
import type { PerfOs } from './os';
import type { PerfDigest, SessionEvent } from './types';

/** A batch's hard size limit. */
export const DIGEST_MAX_BYTES = 6144;

export interface DigestMeta {
  session: string;
  /** The batch's number in this page session, from 1. */
  seq: number;
  /** performance.timeOrigin: when the page started, ms since 1970. */
  t0: number;
  app: string;
  shell: string;
  os: PerfOs;
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
    seq: meta.seq,
    t0: Math.round(meta.t0),
    app: meta.app.slice(0, 40),
    shell: meta.shell.slice(0, 20),
    os: meta.os,
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

  if (w.events.length) d.ev = w.events.map(toSessionEvent);
  if (w.evDropped) d.evDropped = w.evDropped;

  if (d.fgMs < 1000 && !d.launch && !d.nav && !d.lt && !d.freeze && !d.ev) return null;
  return fitDigest(d);
}

const r = Math.round;

/** A pending record in the batch's short form. */
export function toSessionEvent(e: PendingEvent): SessionEvent {
  switch (e.k) {
    case 'nav': {
      const n = e.r;
      return {
        k: 'nav',
        at: r(n.at),
        to: n.to,
        via: n.via,
        lt: r(n.lt),
        ...(n.total !== undefined ? { ms: r(n.total) } : {}),
        ...(n.server !== undefined ? { server: r(n.server) } : {}),
        ...(n.commit !== undefined ? { commit: r(n.commit) } : {}),
        ...(n.playing ? { playing: true } : {}),
        ...(n.abandoned ? { abandoned: true } : {}),
        ...(n.area ? { area: n.area } : {}),
      };
    }
    case 'freeze':
      return { k: 'freeze', at: r(e.r.at), ms: r(e.r.gapMs) };
    case 'rage':
      return {
        k: 'rage',
        at: r(e.r.at),
        target: e.r.target,
        taps: e.r.taps,
        overlay: e.r.overlay,
        inert: e.r.inert,
        ...(e.r.pendingMs !== undefined ? { pending: r(e.r.pendingMs) } : {}),
      };
    case 'slow':
      return { k: 'slow', at: r(e.r.at), type: e.r.type, ms: r(e.r.ms), ...(e.r.target ? { target: e.r.target } : {}) };
  }
}

/** Drops the least useful parts until the digest fits DIGEST_MAX_BYTES. */
export function fitDigest(d: PerfDigest): PerfDigest {
  const size = () => new TextEncoder().encode(JSON.stringify(d)).length;
  if (size() <= DIGEST_MAX_BYTES) return d;
  // Events first, oldest first, but never all: the newest say most.
  while (d.ev && d.ev.length > 5 && size() > DIGEST_MAX_BYTES) {
    d.ev.shift();
    d.evDropped = (d.evDropped ?? 0) + 1;
  }
  if (size() <= DIGEST_MAX_BYTES) return d;
  const steps: (() => void)[] = [
    () => delete d.api,
    () => d.lt && delete d.lt.top,
    () => d.nav && delete d.nav.worst,
    () => d.nav && (d.nav.ms = d.nav.ms.slice(0, 5)),
    () => d.launch && delete d.launch.proto,
    () => delete d.device.model,
    () => {
      d.evDropped = (d.evDropped ?? 0) + (d.ev?.length ?? 0);
      delete d.ev;
    },
  ];
  for (const step of steps) {
    step();
    if (size() <= DIGEST_MAX_BYTES) return d;
  }
  return d;
}
