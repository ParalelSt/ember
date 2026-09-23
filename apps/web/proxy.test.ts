// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));

const { default: proxy, isStaticAsset } = await import('./proxy');

/** A minimal stand-in for Next's NextURL: proxy() only reads pathname,
 *  protocol and searchParams, and clones itself for the /auth redirect. */
class FakeNextUrl extends URL {
  clone(): FakeNextUrl {
    return new FakeNextUrl(this.toString());
  }
}

/** A minimal stand-in for NextRequest: proxy() only reads .headers,
 *  .nextUrl and .cookies-via-headers. */
function req(pathname: string, opts: { cookie?: string } = {}): NextRequest {
  const url = new FakeNextUrl(`http://127.0.0.1${pathname}`);
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return {
    headers,
    nextUrl: url,
  } as unknown as NextRequest;
}

describe('proxy [bughunt W05]: unauthenticated /api/* gets 401 JSON, not a redirect', () => {
  it('answers a protected API path with 401 JSON when there is no session', async () => {
    const res = await proxy(req('/api/playlists'));
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('still 307-redirects an unauthenticated page request to /auth', async () => {
    const res = await proxy(req('/library'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/auth');
    expect(location).toContain('next=%2Flibrary');
  });

  it('leaves a public API path open with no session (no 401, no redirect)', async () => {
    const res = await proxy(req('/api/search?q=test'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('leaves the /pb proxy path open with no session', async () => {
    const res = await proxy(req('/pb/api/collections/users/auth-with-password'));
    expect(res.status).toBe(200);
  });
});

// What the proxy lets through without a session (bughunt W01): Next's own
// files and public images, never an API route that happens to end in .js.
describe('isStaticAsset', () => {
  it('covers Next files and public images', () => {
    for (const p of ['/_next/static/chunks/main.js', '/_next/image', '/icon-192.png', '/favicon-32.png', '/manifest.webmanifest', '/alphatab/font/Bravura.svg']) {
      expect(isStaticAsset(p), p).toBe(true);
    }
  });

  it('does not cover API routes or pages, whatever they end in', () => {
    for (const p of ['/api/playlists/x.js', '/api/admin/users/abc.js', '/api/uploads/x.png', '/library/x.js', '/app.js']) {
      expect(isStaticAsset(p), p).toBe(false);
    }
  });
});
