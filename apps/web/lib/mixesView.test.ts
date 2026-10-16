import { describe, expect, it } from 'vitest';
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
