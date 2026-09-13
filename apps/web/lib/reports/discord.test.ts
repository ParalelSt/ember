import { describe, it, expect } from 'vitest';
import { codeFields, DISCORD_FIELD_CHARS } from './discord';

describe('codeFields', () => {
  it('fences a short block into one field', () => {
    const [only, ...rest] = codeFields('Evidence', 'one line\ntwo lines');
    expect(rest).toHaveLength(0);
    expect(only.name).toBe('Evidence');
    expect(only.value).toBe('```\none line\ntwo lines\n```');
  });

  it('splits on whole lines once a field would exceed the cap', () => {
    const line = 'x'.repeat(120);
    const fields = codeFields('Evidence', Array.from({ length: 20 }, () => line).join('\n'));

    expect(fields.length).toBeGreaterThan(1);
    for (const f of fields) expect(f.value.length).toBeLessThanOrEqual(DISCORD_FIELD_CHARS);
    // No line was cut in half by the split.
    const body = fields.map((f) => f.value.replaceAll('```', '')).join('').split('\n').filter(Boolean);
    for (const l of body) expect(l).toBe(line);
  });

  it('names continuation fields', () => {
    const line = 'y'.repeat(200);
    const names = codeFields('Errors', Array.from({ length: 30 }, () => line).join('\n')).map((f) => f.name);

    expect(names[0]).toBe('Errors');
    expect(names[1]).toBe('Errors (cont.)');
    expect(names[2]).toBe('Errors (cont. 2)');
  });

  it('stops at maxFields and says how much it dropped, rather than building an embed Discord rejects', () => {
    const line = 'z'.repeat(200);
    const fields = codeFields('Errors', Array.from({ length: 200 }, () => line).join('\n'), 3);

    expect(fields).toHaveLength(3);
    for (const f of fields) expect(f.value.length).toBeLessThanOrEqual(DISCORD_FIELD_CHARS);
    expect(fields.at(-1)?.value).toMatch(/\(\d+ more lines omitted\)/);
  });

  it('renders empty text as a placeholder, not an empty field Discord refuses', () => {
    expect(codeFields('Evidence', '')[0].value).toContain('(none)');
  });
});
