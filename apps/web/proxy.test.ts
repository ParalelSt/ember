// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));

const { default: proxy, isStaticAsset, isBlockedPbPath } = await import('./proxy');

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

// PocketBase's superuser surface must never be reachable through the public
// /pb proxy (bughunt W14): the admin UI, superuser sign-in and management,
// settings, backups and logs. The server's own admin client talks to
// PocketBase directly on POCKETBASE_URL, so nothing legitimate goes this way.
describe('proxy [bughunt W14]: the PocketBase superuser surface is not proxied', () => {
  const blocked = [
    '/pb/api/admins/auth-with-password',
    '/pb/api/admins',
    '/pb/api/admins/',
    '/pb/api/admins/request-password-reset',
    '/pb/_/',
    '/pb/_/#/',
    '/pb/_',
    '/pb/_/assets/index.js',
    '/pb/api/settings',
    '/pb/api/settings/test/s3',
    '/pb/api/backups',
    '/pb/api/backups/upload',
    '/pb/api/logs',
    '/pb/api/logs/stats',
    '/pb/api/collections',
    '/pb/api/collections/',
    '/pb/api/collections/import',
    '/pb/api/collections/users',
    '/pb/api/collections/_superusers/auth-with-password',
    // Spellings that still reach the same PocketBase route.
    '/pb/api/%61dmins/auth-with-password',
    '/pb/api/admins%2Fauth-with-password',
    '/pb//api/admins/auth-with-password',
    '/pb/api//admins/auth-with-password',
    '/pb/api/x/../admins/auth-with-password',
    '/pb/api/%2e%2e/api/admins/auth-with-password',
    '/pb/%5F/',
    '/pb/API/Admins/auth-with-password',
  ];

  it('answers every superuser path with a plain 404, before anything reaches PocketBase', async () => {
    for (const p of blocked) {
      const res = await proxy(req(p));
      expect(res.status, p).toBe(404);
    }
  });

  it('flags the same paths in isBlockedPbPath', () => {
    for (const p of blocked) expect(isBlockedPbPath(p), p).toBe(true);
  });

  it('keeps the member-facing PocketBase API open', async () => {
    const open = [
      '/pb/api/collections/users/auth-with-password',
      '/pb/api/collections/users/auth-refresh',
      '/pb/api/collections/users/auth-methods',
      '/pb/api/collections/users/request-password-reset',
      '/pb/api/collections/playlists/records',
      '/pb/api/collections/playlists/records/abc123',
      '/pb/api/collections/likes/records?filter=x',
      '/pb/api/files/playlists/abc/cover.png',
      '/pb/api/files/token',
      '/pb/api/realtime',
      '/pb/api/health',
    ];
    for (const p of open) {
      expect(isBlockedPbPath(p), p).toBe(false);
      const res = await proxy(req(p));
      expect(res.status, p).toBe(200);
    }
  });

  it('leaves non-/pb paths to the rest of the proxy', () => {
    for (const p of ['/api/admin/users', '/_next/static/x.js', '/admin', '/api/settings']) {
      expect(isBlockedPbPath(p), p).toBe(false);
    }
  });
});
