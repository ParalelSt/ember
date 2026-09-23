// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));

const { isStaticAsset } = await import('./proxy');

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
