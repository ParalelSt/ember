// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');

function request(body: unknown, opts: { type?: string; proto?: string } = {}): NextRequest {
  const headers = new Headers({ 'content-type': opts.type ?? 'application/json' });
  if (opts.proto) headers.set('x-forwarded-proto', opts.proto);
  return {
    headers,
    nextUrl: new URL('http://127.0.0.1/api/ui-mode'),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as NextRequest;
}
const post = (body: unknown, opts?: { type?: string; proto?: string }) => POST(request(body, opts), undefined as never);

describe('POST /api/ui-mode', () => {
  it('sets the ember_ui cookie for a year, on the whole site', async () => {
    const res = await post({ mode: 'legacy' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'legacy' });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('ember_ui=legacy');
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=31536000/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it('switches back to the new look, Secure behind https', async () => {
    const res = await post({ mode: 'new' }, { proto: 'https' });
    expect(res.headers.get('set-cookie')).toContain('ember_ui=new');
    expect(res.headers.get('set-cookie')).toMatch(/Secure/);
  });

  it('refuses anything but the two modes, without a cookie', async () => {
    for (const body of [{ mode: 'old' }, {}, null, { mode: 1 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('refuses a body that is not JSON (a cross-site form)', async () => {
    const res = await post({ mode: 'legacy' }, { type: 'application/x-www-form-urlencoded' });
    expect(res.status).toBe(415);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
