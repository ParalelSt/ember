import { describe, it, expect } from 'vitest';
import { codeFields, DISCORD_EMBED_CHARS, DISCORD_FIELD_CHARS, remainingEmbedBudget } from './discord';

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

describe('remainingEmbedBudget', () => {
  it('leaves the full budget minus the safety margin when nothing else is used', () => {
    expect(remainingEmbedBudget(0)).toBe(DISCORD_EMBED_CHARS - 200);
  });

  it('never goes negative when the rest of the embed already overruns the budget', () => {
    expect(remainingEmbedBudget(DISCORD_EMBED_CHARS * 2)).toBe(0);
  });
});

describe('codeFields with a character budget (maxChars)', () => {
  const line = 'x'.repeat(120);
  const bigText = Array.from({ length: 40 }, () => line).join('\n');

  it('is unaffected by maxChars when the fields comfortably fit', () => {
    const withBudget = codeFields('Evidence', 'one line\ntwo lines', 6, 5000);
    const withoutBudget = codeFields('Evidence', 'one line\ntwo lines');
    expect(withBudget).toEqual(withoutBudget);
  });

  it('truncates the last field and marks how many lines were cut once the budget runs out', () => {
    const noBudget = codeFields('Evidence', bigText, 6);
    const totalNoBudget = noBudget.reduce((n, f) => n + f.name.length + f.value.length, 0);
    // A budget smaller than the unconstrained total forces truncation.
    const tightBudget = Math.floor(totalNoBudget / 2);

    const fields = codeFields('Evidence', bigText, 6, tightBudget);

    expect(fields.length).toBeGreaterThan(0);
    const total = fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(tightBudget);
    expect(fields.at(-1)?.value).toMatch(/\(\d+ more lines? omitted\)/);
  });

  it('keeps a whole embed under the 6000-char cap end to end', () => {
    const title = 'Daily error digest 2026-09-13';
    const description = 'D'.repeat(500);
    const footerText = 'F'.repeat(200);
    const otherFieldsChars = 100;
    const used = title.length + description.length + footerText.length + otherFieldsChars;

    const fields = codeFields('Errors', bigText, 6, remainingEmbedBudget(used));
    const fieldsChars = fields.reduce((n, f) => n + f.name.length + f.value.length, 0);

    expect(used + fieldsChars).toBeLessThanOrEqual(DISCORD_EMBED_CHARS);
  });

  it('drops the field entirely rather than emit one Discord would still reject when there is no room at all', () => {
    const fields = codeFields('Evidence', bigText, 6, 0);
    expect(fields).toEqual([]);
  });
});
