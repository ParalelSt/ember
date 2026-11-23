import { describe, it, expect } from 'vitest';
import {
  codeFields,
  DEFAULT_PERF_THREAD_ID,
  DISCORD_EMBED_CHARS,
  DISCORD_FIELD_CHARS,
  perfWebhook,
  remainingEmbedBudget,
  withThreadId,
} from './discord';

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

  it('cuts a single line longer than a field, which Discord would refuse whole', () => {
    // A long client error message (a JSON parse error quoting the body, a
    // minified React error) is one line on its own.
    const long = 'q'.repeat(3000);
    for (const fields of [codeFields('Evidence', `short\n${long}\nafter`), codeFields('Evidence', long, 6, 5000)]) {
      expect(fields.length).toBeGreaterThan(0);
      for (const f of fields) expect(f.value.length).toBeLessThanOrEqual(DISCORD_FIELD_CHARS);
    }
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

describe('the perf rollup webhook', () => {
  const BUGS = 'https://discord.com/api/webhooks/0/example-token';

  it('adds thread_id to a URL with or without a query, replacing one already there', () => {
    expect(withThreadId(BUGS, '42')).toBe(`${BUGS}?thread_id=42`);
    expect(withThreadId(`${BUGS}?wait=true`, '42')).toBe(`${BUGS}?wait=true&thread_id=42`);
    expect(withThreadId(`${BUGS}?thread_id=1&wait=true`, '42')).toBe(`${BUGS}?thread_id=42&wait=true`);
    expect(withThreadId('not a url', '42')).toBe('');
  });

  it('uses DISCORD_PERF_WEBHOOK_URL as it is when set', () => {
    const own = 'https://discord.com/api/webhooks/0/example-perf?thread_id=9';
    expect(perfWebhook({ DISCORD_PERF_WEBHOOK_URL: own, DISCORD_BUG_REPORT_WEBHOOK_URL: BUGS })).toEqual({ url: own, via: 'perf' });
  });

  it('falls back to the bug-report webhook, into the perf thread', () => {
    expect(perfWebhook({ DISCORD_BUG_REPORT_WEBHOOK_URL: BUGS })).toEqual({
      url: `${BUGS}?thread_id=${DEFAULT_PERF_THREAD_ID}`,
      via: 'bug-report-thread',
    });
    expect(DEFAULT_PERF_THREAD_ID).toBe('1574541246045618378');
    expect(perfWebhook({ DISCORD_BUG_REPORT_WEBHOOK_URL: BUGS, DISCORD_PERF_WEBHOOK_URL: '  ' }).via).toBe('bug-report-thread');
  });

  it('takes the thread from DISCORD_PERF_THREAD_ID, ignoring one that is not an id', () => {
    expect(perfWebhook({ DISCORD_BUG_REPORT_WEBHOOK_URL: BUGS, DISCORD_PERF_THREAD_ID: '123456789' }).url).toBe(`${BUGS}?thread_id=123456789`);
    expect(perfWebhook({ DISCORD_BUG_REPORT_WEBHOOK_URL: BUGS, DISCORD_PERF_THREAD_ID: 'x&y=1' }).url).toBe(
      `${BUGS}?thread_id=${DEFAULT_PERF_THREAD_ID}`,
    );
  });

  it('has no target without any webhook, or with PERF_ROLLUP_DISABLED=1', () => {
    expect(perfWebhook({})).toEqual({ url: '', via: 'none' });
    expect(perfWebhook({ DISCORD_BUG_REPORT_WEBHOOK_URL: 'nonsense' })).toEqual({ url: '', via: 'none' });
    expect(perfWebhook({ DISCORD_BUG_REPORT_WEBHOOK_URL: BUGS, PERF_ROLLUP_DISABLED: '1' })).toEqual({ url: '', via: 'none' });
  });
});
