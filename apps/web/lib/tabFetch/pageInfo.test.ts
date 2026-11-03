// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { serverLogger } from '@/lib/logger/server';
import { PoliteFetcher } from './polite';
import { findOnline, resetOnline } from './online';
import { diagnosePage, pageTitle, unreadableLog } from './pageInfo';

const FIXTURES = path.resolve(__dirname, '../../../../tests/fixtures/ug');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const SONG = { title: 'Harbour Lights', artist: 'The Lantern Keepers', trackId: 'youtube:abc123' };

describe('pageTitle', () => {
  it('trims, collapses whitespace and scrubs URL query values', () => {
    expect(pageTitle(fixture('blocked-captcha.html'))).toBe('Just a moment...');
    expect(pageTitle('<title>see https://x.test/a?q=secret&r=1</title>')).not.toContain('secret');
  });
  it('caps a long title and returns null without one', () => {
    expect(pageTitle(`<title>${'a'.repeat(500)}</title>`)!.length).toBeLessThan(130);
    expect(pageTitle('<html></html>')).toBeNull();
  });
});

describe('diagnosePage', () => {
  const meta = { status: 200, contentType: 'text/html; charset=utf-8', length: 321 };
  it('flags a captcha wall', () => {
    const d = diagnosePage(fixture('blocked-captcha.html'), meta);
    expect(d).toMatchObject({ status: 200, contentType: 'text/html; charset=utf-8', length: 321, title: 'Just a moment...', blocked: 'captcha' });
    expect(unreadableLog('ultimate guitar search page', d)).toEqual({ level: 'warn', message: 'ultimate guitar search page is a captcha page, backing off' });
  });
  it('flags a consent wall by its title', () => {
    expect(diagnosePage('<title>Before you continue</title>', meta).blocked).toBe('consent');
  });
  it('leaves a page that merely changed shape as an error', () => {
    const d = diagnosePage(fixture('changed-shape.html'), meta);
    expect(d).toMatchObject({ title: 'Ultimate Guitar search', blocked: null });
    expect(unreadableLog('ultimate guitar search page', d).level).toBe('error');
  });
});

describe('unreadable UG search page logging', () => {
  let fake: FakePb;
  let dir: string;
  beforeEach(() => {
    resetOnline();
    fake = fakePocketBase();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-pageinfo-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function run(html: string) {
    const warn = vi.spyOn(serverLogger, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(serverLogger, 'error').mockImplementation(() => {});
    const fetchFn = (async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const fetcher = new PoliteFetcher({ fetch: fetchFn, sleep: async () => {} });
    await findOnline(fake.pb, SONG, { sites: ['ug'], fetcher, dir });
    return { warn, error };
  }

  it('a captcha page logs a warning with status, type, length and title but no HTML', async () => {
    const html = fixture('blocked-captcha.html');
    const { warn, error } = await run(html);
    expect(error).not.toHaveBeenCalled();
    const call = warn.mock.calls.find((c) => String(c[1]).includes('captcha page'))!;
    expect(call[2]).toMatchObject({ status: 200, contentType: 'text/html', length: html.length, title: 'Just a moment...', blocked: 'captcha' });
    expect(JSON.stringify(call[2])).not.toContain('<body>');
  });

  it('a changed page stays an error but now carries the same detail', async () => {
    const { error } = await run(fixture('changed-shape.html'));
    const call = error.mock.calls.find((c) => String(c[1]).includes('unreadable'))!;
    expect(call[2]).toMatchObject({ status: 200, title: 'Ultimate Guitar search', blocked: null });
  });
});
