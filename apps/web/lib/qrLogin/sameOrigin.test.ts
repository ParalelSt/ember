// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { csrfRefusal } from './sameOrigin';

function post(headers: Record<string, string>, url = 'http://127.0.0.1:3000/api/auth/qr/approve'): Request {
  return new Request(url, { method: 'POST', headers, body: '{}' });
}
const JSON_CT = { 'content-type': 'application/json' };

afterEach(() => {
  delete process.env.PUBLIC_ORIGIN;
});

describe('csrfRefusal (approve, deny, lookup, revoke)', () => {
  it('lets a same-origin JSON POST through', () => {
    expect(csrfRefusal(post({ ...JSON_CT, host: 'ember.example', origin: 'https://ember.example' }))).toBeNull();
    expect(csrfRefusal(post({ ...JSON_CT, 'content-type': 'application/json; charset=utf-8', host: 'ember.example', origin: 'https://ember.example' }))).toBeNull();
  });

  it('lets a JSON POST without an Origin header through (older WebViews omit it on same-origin)', () => {
    expect(csrfRefusal(post({ ...JSON_CT, host: 'ember.example' }))).toBeNull();
  });

  it('matches the public host behind a proxy', () => {
    expect(csrfRefusal(post({ ...JSON_CT, host: 'localhost:3000', 'x-forwarded-host': 'ember.ts.net', origin: 'https://ember.ts.net' }))).toBeNull();
    process.env.PUBLIC_ORIGIN = 'https://music.example';
    expect(csrfRefusal(post({ ...JSON_CT, host: 'localhost:3000', origin: 'https://music.example' }))).toBeNull();
  });

  it('refuses another site\'s Origin', async () => {
    for (const origin of ['https://evil.example', 'https://ember.example.evil.example', 'http://ember.example:8080', 'null']) {
      const res = csrfRefusal(post({ ...JSON_CT, host: 'ember.example', origin }));
      expect(res?.status, origin).toBe(403);
      expect(await res!.json()).toEqual({ error: 'Forbidden' });
    }
  });

  it('refuses a cross-site fetch by Sec-Fetch-Site even without an Origin', () => {
    expect(csrfRefusal(post({ ...JSON_CT, host: 'ember.example', 'sec-fetch-site': 'cross-site' }))?.status).toBe(403);
    expect(csrfRefusal(post({ ...JSON_CT, host: 'ember.example', 'sec-fetch-site': 'same-origin' }))).toBeNull();
  });

  it('refuses anything that is not JSON (a plain HTML form cannot send JSON)', () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
      const res = csrfRefusal(post({ 'content-type': ct, host: 'ember.example', origin: 'https://ember.example' }));
      expect(res?.status, ct).toBe(415);
    }
  });
});
