import { describe, expect, it } from 'vitest';
import { buildPlatformRollup } from '@/lib/perf/platformRollup';
import type { StoredDigest } from '@/lib/perf/sessions';
import { DISCORD_EMBED_CHARS, DISCORD_FIELD_CHARS } from './discord';
import { embedChars, ms, rollupMessage, windowLabel } from './perfRollupEmbeds';

/** The perf channel's message: five platform embeds, always, each titled
 *  with the window, under Discord's limits whatever the data. */

const SINCE = Date.UTC(2026, 10, 23, 6);
const UNTIL = Date.UTC(2026, 10, 23, 12);

function stored(userId: string, session: string, os: string, extra: Record<string, unknown> = {}): StoredDigest {
  return {
    ts: SINCE + 60_000,
    userId,
    digest: { v: 1, session, seq: 1, t0: SINCE, app: '0.7.51', shell: 'capacitor', os: os as never, device: { mem: 4, cores: 8 }, fgMs: 600_000, ...extra },
  };
}

describe('windowLabel', () => {
  it('names the window in UTC, with both days only when it crosses one', () => {
    expect(windowLabel(SINCE, UNTIL)).toBe('2026-11-23 06:00 to 12:00 UTC');
    expect(windowLabel(Date.UTC(2026, 10, 22, 18), Date.UTC(2026, 10, 23, 0))).toBe('2026-11-22 18:00 to 00:00 UTC');
    expect(windowLabel(Date.UTC(2026, 10, 22, 21), Date.UTC(2026, 10, 23, 3))).toBe('2026-11-22 21:00 to 2026-11-23 03:00 UTC');
  });

  it('prints ms under a second and seconds above', () => {
    expect(ms(840)).toBe('840 ms');
    expect(ms(57_000)).toBe('57.0 s');
  });
});

describe('rollupMessage: what the digest\'s Performance section carried', () => {
  const srv = (over: Record<string, unknown>) =>
    ({ ts: SINCE + 1000, kind: 'log', level: 'info', category: 'native', message: 'n', sessionId: 'server', side: 'server', reqId: '', route: '', ...over }) as never;

  it('shows native renderer and memory events per platform, the desktop app\'s on the host, and heap per hour per model', () => {
    const H = 3_600_000;
    const entries = [
      { ...stored('u1', 'a', 'android', { heap: { used: 40 }, device: { model: 'Pixel 8' } }), ts: SINCE + 1000 },
      { ...stored('u1', 'a', 'android', { seq: 2, heap: { used: 52 }, device: { model: 'Pixel 8' } }), ts: SINCE + 1000 + H },
    ];
    const server = [
      srv({ surface: 'phone', data: { event: 'renderer.gone' } }),
      srv({ surface: 'android-auto', data: { event: 'memory.trim' } }),
      srv({ data: { event: 'memory.low' } }),
      srv({ surface: 'desktop', data: { event: 'renderer.unresponsive' } }),
      srv({ category: 'perf', message: 'server timing', data: { routes: [{ route: '/settings (rsc)', n: 4, p50: 900, p95: 4000, max: 5000 }], slow: 2, health: { loopP99: 40 } } }),
    ];
    const { embeds } = rollupMessage(buildPlatformRollup(entries, SINCE, SINCE + 6 * H, server));
    const android = embeds[0];
    expect(android.fields.find((f) => f.name === 'Native app')!.value).toBe('renderer deaths 1 · unresponsive 0 · low memory 1 · trim 1');
    expect(android.fields.find((f) => f.name === 'Memory')!.value).toContain('heap per hour: Pixel 8 +12 MB (1)');
    const host = embeds[5];
    expect(host.description).toBe('4 requests · 2 slow · event loop p99 up to 40 ms');
    expect(host.fields.find((f) => f.name === 'Slowest server routes')!.value).toBe('/settings (rsc) p50 900 ms · p95 4.0 s · max 5.0 s (4)');
    expect(host.fields.find((f) => f.name === 'Desktop app (any OS)')!.value).toBe('renderer deaths 0 · unresponsive 1 · low memory 0 · trim 0');
  });

  it('puts the host\'s numbers for each side nav destination next to the platforms\' taps', () => {
    const ev = [{ k: 'nav', at: 1, to: '/settings', via: 'tap', ms: 6000, server: 5000, commit: 300, lt: 0, area: 'drawer' }];
    const server = [
      srv({ category: 'perf', message: 'server timing', data: { routes: [{ route: '/settings (rsc)', n: 10, p50: 4800, p95: 6000, max: 9000 }, { route: '/library (rsc)', n: 3, p50: 100, p95: 200, max: 300 }] } }),
    ];
    const r = buildPlatformRollup([stored('u1', 'a', 'android', { ev })], SINCE, UNTIL, server);
    expect(r.host.sideNav).toEqual([{ route: '/settings (rsc)', n: 10, p50: 4800, p95: 6000, max: 9000 }]);
    const field = rollupMessage(r).embeds[5].fields.find((f) => f.name === 'Side nav pages on the host')!;
    expect(field.value).toBe('/settings (rsc) p50 4.8 s · p95 6.0 s · max 9.0 s (10)');
  });
});

describe('rollupMessage', () => {
  it('always five platform embeds, Android to Linux, empty ones saying so, iOS included, then the host', () => {
    const r = buildPlatformRollup([stored('u1', 'a', 'android', { nav: { n: 1, ms: [900] } }), stored('u2', 'o', 'other')], SINCE, UNTIL);
    const { content, embeds } = rollupMessage(r);
    expect(embeds.map((e) => e.title)).toEqual([
      'Android · 2026-11-23 06:00 to 12:00 UTC',
      'iOS · 2026-11-23 06:00 to 12:00 UTC',
      'Windows · 2026-11-23 06:00 to 12:00 UTC',
      'macOS · 2026-11-23 06:00 to 12:00 UTC',
      'Linux · 2026-11-23 06:00 to 12:00 UTC',
      'Host · 2026-11-23 06:00 to 12:00 UTC',
    ]);
    expect(embeds[5].description).toBe('No host timing lines in this window.');
    expect(embeds[0].description).toContain('1 session · 1 member');
    expect(embeds[0].description).toContain('phone app 1');
    expect(embeds[0].fields.map((f) => f.name)).toEqual(expect.arrayContaining(['Navigation', 'Side nav', 'Jank', 'Typical device']));
    expect(embeds[1].description).toMatch(/^No sessions yet/);
    expect(embeds[1].fields).toEqual([]);
    expect(embeds[2].description).toBe('No sessions in this window.');
    expect(content).toContain('2 sessions, 2 members (1 on other platforms');
  });

  it('shows side nav destinations with host wait vs page work and re-taps', () => {
    const ev = [
      { k: 'nav', at: 1, to: '/settings', via: 'tap', ms: 6000, server: 5000, commit: 300, lt: 0, area: 'drawer' },
      { k: 'nav', at: 2, to: '/settings', via: 'tap', lt: 0, area: 'drawer', abandoned: true },
    ];
    const { embeds } = rollupMessage(buildPlatformRollup([stored('u1', 'a', 'android', { ev })], SINCE, UNTIL));
    const side = embeds[0].fields.find((f) => f.name === 'Side nav')!.value;
    expect(side).toContain('1 tap loaded, 1 re-tapped before loading');
    expect(side).toContain('/settings 1× p50 6.0 s p95 6.0 s · host 5.0 s / page 300 ms · 1 re-tapped');
  });

  it('puts tap to content in the side nav lines, the slow routes and its own field', () => {
    const ev = [
      { k: 'nav', at: 1, to: '/library', via: 'tap', ms: 300, server: 100, commit: 50, lt: 0, area: 'sidebar', ready: 2800, wait: 2500, api: '/api/playlists' },
      { k: 'nav', at: 2, to: '/library', via: 'tap', ms: 400, lt: 0, area: 'sidebar', ready: 1400, wait: 1000, api: '/api/playlists' },
    ];
    const { embeds } = rollupMessage(buildPlatformRollup([stored('u1', 'a', 'android', { ev, nav: { n: 2, ms: [300, 400] } })], SINCE, UNTIL));
    const side = embeds[0].fields.find((f) => f.name === 'Side nav')!.value;
    expect(side).toContain('tap to content p50 1.4 s p95 2.8 s (data wait p50 1.0 s, last /api/playlists)');
    expect(embeds[0].fields.find((f) => f.name === 'Tap to content')!.value).toBe('all pages p50 1.4 s · p95 2.8 s (2)');
    expect(embeds[0].fields.find((f) => f.name === 'Slowest routes')!.value).toContain('content p50 1.4 s p95 2.8 s');
  });

  it('shows each slow host route split into auth, db and the rest', () => {
    const srv = (over: Record<string, unknown>) =>
      ({ ts: SINCE + 1000, kind: 'log', level: 'info', category: 'native', message: 'n', sessionId: 'server', side: 'server', reqId: '', route: '', ...over }) as never;
    const server = [
      srv({
        category: 'perf',
        message: 'server timing',
        data: {
          routes: [
            { route: '/api/playlists', n: 87, p50: 600, p95: 2500, max: 4000, ph: { auth: 120, db: 430, upstream: 0 } },
            { route: '/api/youtube/recommended', n: 20, p50: 1900, p95: 3000, max: 5000, ph: { auth: 10, db: 100, upstream: 1500 } },
            { route: '/api/version', n: 9, p50: 5, p95: 8, max: 9 },
          ],
        },
      }),
    ];
    const r = buildPlatformRollup([], SINCE, UNTIL, server);
    const slowest = rollupMessage(r).embeds[5].fields.find((f) => f.name === 'Slowest server routes')!.value.split('\n');
    expect(slowest[0]).toBe('/api/youtube/recommended p50 1.9 s · p95 3.0 s · max 5.0 s (20) · auth 10 ms, db 100 ms, upstream 1.5 s, other 290 ms');
    expect(slowest[1]).toBe('/api/playlists p50 600 ms · p95 2.5 s · max 4.0 s (87) · auth 120 ms, db 430 ms, other 50 ms');
    expect(slowest[2]).toBe('/api/version p50 5 ms · p95 8 ms · max 9 ms (9)');
  });

  it('stays under Discord\'s limits with every platform full of long routes', () => {
    const entries: StoredDigest[] = [];
    for (const os of ['android', 'ios', 'windows', 'macos', 'linux']) {
      for (let i = 0; i < 40; i++) {
        const route = `/${'x'.repeat(100)}${i}`;
        entries.push(
          stored(`u${i}`, `${os}-${i}`, os, {
            launch: { fcp: 1000 + i, hydrated: 4000 + i },
            heap: { used: 40 + i },
            dom: 3000,
            freeze: { n: 1, max: 5000 },
            ev: [{ k: 'nav', at: 1, to: route, via: 'tap', ms: 1000 + i, server: 500, commit: 100, lt: 0, area: 'sidebar', ready: 9000 + i, wait: 8000, api: `/${'a'.repeat(60)}` }],
          }),
        );
      }
    }
    const server = Array.from({ length: 72 }, (_, i) => ({
      ts: SINCE + 1000 + i,
      kind: 'log',
      level: 'info',
      category: 'perf',
      message: 'server timing',
      sessionId: 'server',
      side: 'server',
      reqId: '',
      route: '',
      data: { routes: Array.from({ length: 20 }, (_, j) => ({ route: `/${'y'.repeat(100)}${j} (rsc)`, n: 5, p50: 100 * j, p95: 1000 * j, max: 2000 * j, ph: { auth: 10 * j, db: 20 * j, upstream: 30 * j } })), slow: 3, health: { loopP99: 80 } },
    })) as never[];
    for (let i = 0; i < 40; i++) entries.push(stored(`h${i}`, `heap-${i}`, 'android', { device: { model: `model ${'z'.repeat(30)} ${i}` }, heap: { used: 40 } }));
    const { content, embeds } = rollupMessage(buildPlatformRollup(entries, SINCE, UNTIL, server));
    expect(embeds).toHaveLength(6);
    expect(embeds.reduce((n, e) => n + embedChars(e), 0)).toBeLessThanOrEqual(DISCORD_EMBED_CHARS);
    for (const e of embeds) {
      expect(e.title.length).toBeLessThanOrEqual(256);
      expect(e.fields.length).toBeLessThanOrEqual(25);
      for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(DISCORD_FIELD_CHARS);
    }
    expect(content.length).toBeLessThanOrEqual(2000);
  });
});
