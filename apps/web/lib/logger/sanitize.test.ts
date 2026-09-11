import { describe, it, expect } from 'vitest';
import { scrub, scrubText } from './sanitize';

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
