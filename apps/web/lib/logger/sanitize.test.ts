import { describe, it, expect } from 'vitest';
import { scrub, scrubServerEntry, scrubText } from './sanitize';
import type { ServerLogEntry } from './types';

describe('scrub', () => {
  it('redacts sensitive field names and leaves the rest alone', () => {
    const out = scrub({ token: 'secret', route: '/library' }) as Record<string, unknown>;
    expect(out.token).toBe('[scrubbed]');
    expect(out.route).toBe('/library');
  });
});

describe('scrubText', () => {
  it('redacts a bearer token', () => {
    const out = scrubText('Authorization: Bearer sk-ant-abcdefgh12345678');
    expect(out).not.toContain('sk-ant-abcdefgh12345678');
    expect(out).toContain('[scrubbed]');
  });

  it('redacts a cookie header, including pb_auth inside it', () => {
    const out = scrubText('Cookie: pb_auth=eyJhbGciOiJIUzI1NiJ9.abc123; theme=dark');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('pb_auth=');
    expect(out).toContain('[scrubbed]');
  });

  it('redacts a bare pb_auth assignment outside a Cookie header', () => {
    const out = scrubText('set pb_auth=eyJhbGciOiJIUzI1NiJ9.abc123 on request');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('pb_auth=[scrubbed]');
  });

  it('redacts search query string values but keeps the keys and path', () => {
    const out = scrubText('GET /search?q=some+private+search+terms&user=me HTTP/1.1');
    expect(out).not.toContain('some+private+search+terms');
    expect(out).toContain('/search?q=[scrubbed]');
    expect(out).toContain('&user=[scrubbed]');
  });

  it('redacts a long hex blob', () => {
    const out = scrubText(`session hash ${'a'.repeat(40)}`);
    expect(out).not.toContain('a'.repeat(40));
    expect(out).toContain('[scrubbed]');
  });

  it('redacts a long base64-looking blob', () => {
    const blob = 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Qgc3RyaW5nIGZvciBzY3J1YmJpbmc=';
    const out = scrubText(`payload ${blob}`);
    expect(out).not.toContain(blob);
    expect(out).toContain('[scrubbed]');
  });

  it('leaves ordinary lines untouched', () => {
    const line = 'navigate to /library, nothing playing, online';
    expect(scrubText(line)).toBe(line);
  });

  it('scrubs every matching line, not just the first', () => {
    const out = scrubText(
      ['first line is fine', 'Authorization: Bearer sk-ant-abcdefgh12345678', 'last line is fine'].join('\n'),
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe('first line is fine');
    expect(lines[1]).not.toContain('sk-ant-abcdefgh12345678');
    expect(lines[2]).toBe('last line is fine');
  });
});

// A query string anywhere in `data` used to swallow the JSON's closing quote,
// the re-parse failed, and the whole object became "[object Object]".
describe('scrubServerEntry', () => {
  const entry = (data: unknown): ServerLogEntry => ({
    ts: 1, kind: 'error', level: 'error', category: 'api', message: 'm', data,
    sessionId: 's', side: 'server', reqId: 'r', route: '/x',
  });

  it('keeps the data object, scrubbing only the query value', () => {
    const out = scrubServerEntry(entry({ url: '/api/search?q=hello', status: 502, args: ['search', '--', 'q'] }));
    expect(out.data).toEqual({ url: '/api/search?q=[scrubbed]', status: 502, args: ['search', '--', 'q'] });
  });

  it('keeps a nested object whose strings need no scrubbing', () => {
    const data = { args: ['album', '--', 'MPREb_x'], stderr: 'album failed', nested: { n: 1, ok: true, none: null } };
    expect(scrubServerEntry(entry(data)).data).toEqual(data);
  });

  it('still drops every secret, by shape and by name', () => {
    const data = {
      header: 'Authorization: Bearer sk-ant-abcdefgh12345678',
      headers: { cookie: 'SAPISID=s3cr3tA; HSID=s3cr3tB', authorization: 'SAPISIDHASH 1_s3cr3tC', 'x-goog-authuser': 's3cr3tD' },
      token: 's3cr3tE',
      flow: { accessToken: 's3cr3tF', refresh_token: 's3cr3tG', device_code: 's3cr3tH', clientSecret: 's3cr3tI' },
      lines: ['pb_auth=s3cr3tJ', `hex ${'a'.repeat(40)}`, 'poll said ya29.s3cr3tK'],
      url: '/api/x?token=s3cr3tL&page=2',
    };
    const out = scrubServerEntry(entry(data));
    expect(JSON.stringify(out)).not.toMatch(/s3cr3t|sk-ant-abcdefgh|a{40}/);
    expect(out.data).toMatchObject({ headers: { cookie: '[scrubbed]' }, token: '[scrubbed]' });
  });

  it('scrubs a plain string data the same way as before', () => {
    expect(scrubServerEntry(entry('cookie: pb_auth=abc')).data).toBe('cookie: [scrubbed]');
  });
});
