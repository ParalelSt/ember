import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { builtLine } from './mixesView';

const at = (s: string) => new Date(s).getTime();

describe('builtLine', () => {
  it('says when and from whom', () => {
    const now = at('2026-10-16T12:00:00');
    expect(builtLine({ subtitle: 'Gojira, Tool, Metallica and more', builtAt: new Date(at('2026-10-16T04:00:00')).toISOString() }, now)).toBe('Built today from Gojira, Tool, Metallica');
    expect(builtLine({ subtitle: 'A and more', builtAt: new Date(at('2026-10-15T04:00:00')).toISOString() }, now)).toBe('Built yesterday from A');
    expect(builtLine({ subtitle: 'A and more', builtAt: new Date(at('2026-10-13T04:00:00')).toISOString() }, now)).toBe('Built 3 days ago from A');
    expect(builtLine({ subtitle: '', builtAt: '' }, now)).toBe('Built today');
  });
});

describe('builtLine across a clock change', () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Zagreb';
  });
  afterAll(() => {
    process.env.TZ = tz;
  });

  // 29 March 2026 is 23 hours long in Croatia: a mix built the day before
  // read "Built today", and one built two days before "yesterday".
  it('counts calendar days, not 24-hour blocks', () => {
    const now = new Date(2026, 2, 30, 12).getTime();
    expect(new Date(2026, 2, 29, 12).getTimezoneOffset()).not.toBe(new Date(2026, 2, 28, 12).getTimezoneOffset());
    expect(builtLine({ subtitle: '', builtAt: new Date(2026, 2, 29, 4).toISOString() }, now)).toBe('Built yesterday');
    expect(builtLine({ subtitle: '', builtAt: new Date(2026, 2, 28, 4).toISOString() }, now)).toBe('Built 2 days ago');
    expect(builtLine({ subtitle: '', builtAt: new Date(2026, 2, 29, 4).toISOString() }, new Date(2026, 2, 29, 23).getTime())).toBe('Built today');
  });
});
