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

describe('rollupMessage', () => {
  it('always five embeds, Android to Linux, empty ones saying so, iOS included', () => {
    const r = buildPlatformRollup([stored('u1', 'a', 'android', { nav: { n: 1, ms: [900] } }), stored('u2', 'o', 'other')], SINCE, UNTIL);
    const { content, embeds } = rollupMessage(r);
    expect(embeds.map((e) => e.title)).toEqual([
      'Android · 2026-11-23 06:00 to 12:00 UTC',
      'iOS · 2026-11-23 06:00 to 12:00 UTC',
      'Windows · 2026-11-23 06:00 to 12:00 UTC',
      'macOS · 2026-11-23 06:00 to 12:00 UTC',
      'Linux · 2026-11-23 06:00 to 12:00 UTC',
    ]);
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
            ev: [{ k: 'nav', at: 1, to: route, via: 'tap', ms: 1000 + i, server: 500, commit: 100, lt: 0, area: 'sidebar' }],
          }),
        );
      }
    }
    const { content, embeds } = rollupMessage(buildPlatformRollup(entries, SINCE, UNTIL));
    expect(embeds).toHaveLength(5);
    expect(embeds.reduce((n, e) => n + embedChars(e), 0)).toBeLessThanOrEqual(DISCORD_EMBED_CHARS);
    for (const e of embeds) {
      expect(e.title.length).toBeLessThanOrEqual(256);
      expect(e.fields.length).toBeLessThanOrEqual(25);
      for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(DISCORD_FIELD_CHARS);
    }
    expect(content.length).toBeLessThanOrEqual(2000);
  });
});
