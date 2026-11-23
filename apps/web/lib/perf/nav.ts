import { routeShape } from './route';
import type { NavRecord, RageRecord } from './types';

/** What the navigation tracker needs from the perf core. */
export interface NavHost {
  now(): number;
  /** Long task ms since the page started, only ever growing. */
  ltTotal(): number;
  /** Long task ms that ended in the last `ms`. */
  ltSince(ms: number): number;
  /** The newest RSC request for `path` that started at or after `after`. */
  findRsc(path: string, after: number): RscTiming | undefined;
  playing(): boolean;
  /** Runs `fn` once the next frame has been drawn. */
  afterPaint(fn: () => void): void;
  later(fn: () => void, ms: number): void;
  addNav(rec: NavRecord): void;
  addRage(rec: RageRecord): void;
  doc(): Document;
  currentPath(): string;
}

/** The parts of an RSC request's resource timing a navigation record uses. */
export interface RscTiming {
  path: string;
  start: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  kb: number;
  st?: Record<string, number>;
  proto?: string;
}

interface Pending {
  tapAt: number;
  from: string;
  toPath: string;
  lt0: number;
}

const RAGE_TAPS = 3;
const RAGE_WINDOW_MS = 5000;
/** A tap older than this is not the start of the route change that follows. */
const TAP_MAX_AGE_MS = 120_000;
/** The resource entry can reach the observer after the route change. */
const RSC_RETRY_MS = 600;

const TAP_TARGET = '[data-nav],[data-slot],a[href],button,[role]';

/** The element a tap counts against: the nearest named or interactive
 *  ancestor. */
function tapTarget(el: Element | null): Element | null {
  return el?.closest(TAP_TARGET) ?? el;
}

/** The short name a tap target is logged by, built only from names the
 *  code gave it: data-nav, data-slot, a link's path with its ids taken out,
 *  its role, or its tag. Never aria-label or text, which carry song titles,
 *  theme and file names. */
export function targetLabel(el: Element | null): string {
  const t = tapTarget(el);
  if (!t) return 'unknown';
  const nav = t.getAttribute('data-nav');
  if (nav) return nav.slice(0, 40);
  const slot = t.getAttribute('data-slot');
  if (slot) return slot.slice(0, 40);
  if (t.tagName === 'A' && t.hasAttribute('href')) return `link ${routeShape(t.getAttribute('href') ?? '')}`;
  const role = t.getAttribute('role');
  if (role) return `role ${role.slice(0, 20)}`;
  return t.tagName.toLowerCase();
}

/** Turns taps and route changes into navigation and rage tap records
 *  (section 5.2). Holds at most one pending tap and the last few tap times. */
export class NavTracker {
  private pending: Pending | null = null;
  /** The element the last taps hit: rage taps are counted per element,
   *  since many share one label. Weak, so a closed sheet is not kept. */
  private rageEl: WeakRef<Element> | null = null;
  private rageTaps: number[] = [];

  constructor(private host: NavHost) {}

  /** Capture phase click: a same-origin link starts a pending navigation,
   *  and every tap counts toward a rage tap. */
  onClick(e: MouseEvent): void {
    const now = this.host.now();
    const at = e.timeStamp > 0 && e.timeStamp <= now + 1000 ? e.timeStamp : now;
    const target = e.target instanceof Element ? e.target : null;
    this.countTap(target, at, e.clientX, e.clientY);

    const a = target?.closest('a[href]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    let url: URL;
    try {
      url = new URL(a.href, this.host.doc().baseURI);
    } catch {
      return;
    }
    if (url.origin !== new URL(this.host.doc().baseURI).origin) return;
    const from = this.host.currentPath();
    if (url.pathname === from) return;
    if (this.pending && at - this.pending.tapAt > 1000) {
      this.host.addNav({
        at: Math.round(this.pending.tapAt),
        from: routeShape(this.pending.from),
        to: routeShape(this.pending.toPath),
        via: 'tap',
        lt: Math.round(this.host.ltTotal() - this.pending.lt0),
        abandoned: true,
      });
    }
    const pending = { tapAt: at, from, toPath: url.pathname, lt0: this.host.ltTotal() };
    this.pending = pending;
    // Seen in the capture phase, before the app's own handler: a link that
    // handler cancels (the Search link opens the search sheet) is no
    // navigation.
    this.host.later(() => {
      if (e.defaultPrevented && this.pending === pending) this.pending = null;
    }, 0);
  }

  /** The route changed (history.pushState or back/forward). */
  onRoute(path: string, from: string, how: 'push' | 'pop'): void {
    const commitAt = this.host.now();
    const p = this.pending;
    const fromTap = !!p && p.toPath === path && commitAt - p.tapAt < TAP_MAX_AGE_MS;
    if (p && (fromTap || commitAt - p.tapAt >= TAP_MAX_AGE_MS)) this.pending = null;
    const start = fromTap && p ? p.tapAt : undefined;
    const lt0 = fromTap && p ? p.lt0 : this.host.ltTotal();
    const playing = this.host.playing();
    this.host.afterPaint(() => {
      const paintAt = this.host.now();
      const finish = (retry: boolean) => {
        const rsc = this.host.findRsc(path, start !== undefined ? start - 5 : commitAt - 30_000);
        if (!rsc && retry) {
          this.host.later(() => finish(false), RSC_RETRY_MS);
          return;
        }
        this.host.addNav(buildNav({ path, from, via: fromTap ? 'tap' : how, start, commitAt, paintAt, rsc, lt: this.host.ltTotal() - lt0, playing }));
      };
      finish(true);
    });
  }

  /** Age of the navigation still waiting for its route change, if any. */
  pendingAge(): number | undefined {
    if (!this.pending) return undefined;
    const age = this.host.now() - this.pending.tapAt;
    return age < TAP_MAX_AGE_MS ? age : undefined;
  }

  private countTap(target: Element | null, at: number, x: number, y: number): void {
    const el = tapTarget(target);
    if (!el || el !== this.rageEl?.deref()) {
      this.rageEl = el ? new WeakRef(el) : null;
      this.rageTaps = [];
    }
    this.rageTaps = this.rageTaps.filter((t) => at - t < RAGE_WINDOW_MS);
    this.rageTaps.push(at);
    if (this.rageTaps.length < RAGE_TAPS) return;
    const taps = this.rageTaps.length;
    this.rageTaps = [];
    const key = targetLabel(target);
    const doc = this.host.doc();
    let under: string | undefined;
    try {
      const el = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
      const slot = el?.closest('[data-slot]')?.getAttribute('data-slot');
      under = slot ?? el?.getAttribute('role') ?? el?.tagName.toLowerCase();
    } catch {
      // Not drawn (tests, a detached frame): leave it out.
    }
    const pending = this.pendingAge();
    this.host.addRage({
      at: Math.round(at),
      target: key,
      taps,
      ...(pending !== undefined ? { pendingMs: Math.round(pending) } : {}),
      ...(under ? { under } : {}),
      overlay: !!doc.querySelector('[data-slot$="-overlay"]'),
      inert: !!doc.querySelector('[inert]'),
      lt: Math.round(this.host.ltSince(RAGE_WINDOW_MS)),
    });
  }
}

function buildNav(o: {
  path: string;
  from: string;
  via: NavRecord['via'];
  start?: number;
  commitAt: number;
  paintAt: number;
  rsc?: RscTiming;
  lt: number;
  playing: boolean;
}): NavRecord {
  const { rsc } = o;
  const start = o.start ?? rsc?.start;
  const r = Math.round;
  const rec: NavRecord = {
    at: r(start ?? o.commitAt),
    from: routeShape(o.from),
    to: routeShape(o.path),
    via: o.via,
    lt: r(o.lt),
    playing: o.playing,
  };
  if (start !== undefined) rec.total = r(o.paintAt - start);
  rec.paint = r(o.paintAt - o.commitAt);
  if (rsc) {
    if (o.start !== undefined) rec.tapToRequest = r(Math.max(0, rsc.start - o.start));
    if (rsc.requestStart > 0) {
      rec.queue = r(rsc.requestStart - rsc.start);
      if (rsc.responseStart > 0) rec.server = r(rsc.responseStart - rsc.requestStart);
    }
    if (rsc.responseStart > 0) rec.download = r(rsc.responseEnd - rsc.responseStart);
    rec.kb = rsc.kb;
    rec.commit = r(Math.max(0, o.commitAt - rsc.responseEnd));
    if (rsc.st) rec.st = rsc.st;
    if (rsc.proto) rec.proto = rsc.proto;
  }
  return rec;
}
