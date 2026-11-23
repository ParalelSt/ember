import { DISCORD_EMBED_CHARS, DISCORD_FIELD_CHARS, type EmbedField } from '@/lib/reports/discord';
import {
  PLATFORM_LABEL,
  ROLLUP_PLATFORMS,
  type PlatformRollup,
  type PlatformStats,
  type Quantiles,
} from '@/lib/perf/platformRollup';

/** The perf channel's Discord message for one rollup: a line of totals and
 *  one embed per platform (always five, empty ones included), each titled
 *  with the window. Pure. Discord counts every embed of a message against
 *  one 6000-character budget, so the whole message is kept under it. */

export interface RollupEmbed {
  title: string;
  description: string;
  color: number;
  timestamp: string;
  fields: EmbedField[];
  footer?: { text: string };
}

const COLOR: Record<string, number> = {
  android: 0x3ddc84,
  ios: 0x8e8e93,
  windows: 0x0078d4,
  macos: 0xa2aaad,
  linux: 0xf7b500,
};
const COLOR_EMPTY = 0x4b5563;
/** Room left under Discord's cap for its own counting quirks. */
const MESSAGE_BUDGET = DISCORD_EMBED_CHARS - 300;
const SIDE_NAV_LINES = 5;

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const hm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** "2026-11-23 06:00 to 12:00 UTC", or both days when it crosses one. */
export function windowLabel(since: number, until: number): string {
  const a = new Date(since);
  const b = new Date(until);
  // A window ending at midnight reads as the day it covered.
  const sameDay = day(a) === day(b) || (until - since <= 24 * 3_600_000 && hm(b) === '00:00' && day(a) === day(new Date(until - 1)));
  return sameDay ? `${day(a)} ${hm(a)} to ${hm(b)} UTC` : `${day(a)} ${hm(a)} to ${day(b)} ${hm(b)} UTC`;
}

export function ms(n: number): string {
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function clip(s: string, max = DISCORD_FIELD_CHARS): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function q(label: string, v: Quantiles): string | null {
  return v.n ? `${label} p50 ${ms(v.p50)} · p95 ${ms(v.p95)} (${v.n})` : null;
}

function field(name: string, lines: (string | null)[]): EmbedField | null {
  const kept = lines.filter((l): l is string => !!l);
  return kept.length ? { name, value: clip(kept.join('\n')), inline: false } : null;
}

function sideNavLines(p: PlatformStats, max: number): string[] {
  const s = p.sideNav;
  if (!s.taps && !s.abandoned) return ['No side-nav taps logged.'];
  const lines = [`${plural(s.taps, 'tap')} loaded, ${s.abandoned} re-tapped before loading`];
  for (const r of s.routes.slice(0, max)) {
    const where = r.phased ? ` · host ${ms(r.serverP50)} / page ${ms(r.commitP50)}` : '';
    const left = r.abandoned ? ` · ${r.abandoned} re-tapped` : '';
    lines.push(r.n ? `${r.route} ${r.n}× p50 ${ms(r.p50)} p95 ${ms(r.p95)}${where}${left}` : `${r.route}${left}`);
  }
  return lines;
}

function platformEmbed(p: PlatformStats, title: string, timestamp: string, sideNavMax: number): RollupEmbed {
  const label = PLATFORM_LABEL[p.os];
  const base = { title: `${label} · ${title}`, timestamp };
  if (!p.sessions) {
    return {
      ...base,
      color: COLOR_EMPTY,
      description: p.os === 'ios' ? 'No sessions yet. (No iOS app yet: iPhone and iPad browsers count here.)' : 'No sessions in this window.',
      fields: [],
    };
  }
  const shells = Object.entries(p.shells)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s} ${n}`)
    .join(' · ');
  const description = `${plural(p.sessions, 'session')} · ${plural(p.members, 'member')} · ${p.fgHours} h in front\n${shells}`;
  const device = [
    p.device.memGb !== undefined ? `${p.device.memGb} GB RAM` : null,
    p.device.cores !== undefined ? `${p.device.cores} cores` : null,
  ].filter(Boolean);
  const fields = [
    field('Launch', [q('first paint', p.launch.fcp), q('ready', p.launch.hydrated)]),
    field('Navigation', [p.nav.n ? `${p.nav.n} · p50 ${ms(p.nav.p50)} · p95 ${ms(p.nav.p95)} · max ${ms(p.nav.max)}` : 'none']),
    field('Side nav', sideNavLines(p, sideNavMax)),
    field('Jank', [
      `long tasks ${p.longTaskMsPerMin} ms per minute · freezes ${p.freezes.n}${p.freezes.n ? ` (max ${ms(p.freezes.max)})` : ''}`,
      `rage taps ${p.rageTaps} · slow taps ${p.slowTaps}`,
    ]),
    field('Memory', [
      p.heap.readings ? `heap p50 ${p.heap.p50} MB · max ${p.heap.max} MB` : null,
      p.heap.growth.sessions
        ? `growth per session p95 ${p.heap.growth.p95 >= 0 ? '+' : ''}${p.heap.growth.p95} MB (${plural(p.heap.growth.sessions, 'session')})`
        : null,
      p.domMax ? `DOM nodes max ${p.domMax}` : null,
    ]),
    field('Typical device', [device.length ? device.join(' · ') : null]),
    field('Slowest routes', p.slowestRoutes.map((r) => `${r.route} p95 ${ms(r.p95)} (${r.n})`)),
  ].filter((f): f is EmbedField => f !== null);
  return { ...base, color: COLOR[p.os] ?? COLOR_EMPTY, description, fields };
}

export function embedChars(e: RollupEmbed): number {
  return (
    e.title.length +
    e.description.length +
    (e.footer?.text.length ?? 0) +
    e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

/** The message: `content` (totals) and the five platform embeds. */
export function rollupMessage(rollup: PlatformRollup): { content: string; embeds: RollupEmbed[] } {
  const title = windowLabel(rollup.since, rollup.until);
  const timestamp = new Date(rollup.until).toISOString();
  const other = rollup.totals.byOs.other;
  const content = clip(
    `Perf rollup ${title}: ${plural(rollup.totals.sessions, 'session')}, ${plural(rollup.totals.members, 'member')}` +
      (other ? ` (${other} on other platforms, in the file)` : '') +
      '. Per-session numbers in perf-rollup.json.',
    2000,
  );
  const platforms = ROLLUP_PLATFORMS.map((os) => rollup.platforms.find((p) => p.os === os)!);
  // Fewer side-nav lines until the whole message fits.
  for (let lines = SIDE_NAV_LINES; ; lines--) {
    const embeds = platforms.map((p) => platformEmbed(p, title, timestamp, lines));
    const total = embeds.reduce((n, e) => n + embedChars(e), 0);
    if (total <= MESSAGE_BUDGET) return { content, embeds };
    if (lines === 0) {
      // Still too long (it never should be): cut each embed's fields to a share.
      const share = Math.floor(MESSAGE_BUDGET / embeds.length);
      return {
        content,
        embeds: embeds.map((e) => {
          const fields: EmbedField[] = [];
          let used = e.title.length + e.description.length;
          for (const f of e.fields) {
            const room = share - used - f.name.length;
            if (room < 20) break;
            const value = clip(f.value, room);
            fields.push({ ...f, value });
            used += f.name.length + value.length;
          }
          return { ...e, fields };
        }),
      };
    }
  }
}
