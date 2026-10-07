// @vitest-environment node
import { describe, it, expect } from 'vitest';
import nextConfig from './next.config';
import { MAX_UPLOAD_BYTES } from './lib/uploads';

// [bughunt W04] Next buffers a proxied request body up to
// proxyClientMaxBodySize and silently truncates the rest (no error — see
// node_modules/next/dist/docs/.../proxyClientMaxBodySize.md), so a song
// upload near the 50MB cap in lib/uploads.ts must fit comfortably under the
// configured limit or it arrives as "No file uploaded".
describe('next.config proxyClientMaxBodySize', () => {
  it('covers the largest allowed upload plus multipart overhead', () => {
    const raw = nextConfig.experimental?.proxyClientMaxBodySize;
    expect(raw).toBeDefined();
    const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)$/i.exec(String(raw));
    expect(match).not.toBeNull();
    const [, num, unit] = match!;
    const multiplier = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[unit.toLowerCase()]!;
    const bytes = Number(num) * multiplier;

    expect(bytes).toBeGreaterThan(MAX_UPLOAD_BYTES);
    // Regression guard: 12mb (the old value) truncated a 13MB upload — see
    // FIXER-BRIEF repro. Fail loudly if it ever regresses that low again.
    expect(bytes).toBeGreaterThan(12 * 1024 * 1024);
  });
});

// The /pb rewrite leaves PocketBase's superuser surface out for paths
// proxy.ts's matcher skips; the QR sign-in hook routes (/api/ember/*) are on
// that list too (plan 2d).
describe('next.config /pb rewrite', () => {
  async function pbPathPattern(): Promise<RegExp> {
    const rewrites = await (nextConfig.rewrites as () => Promise<{ source: string }[]>)();
    const pb = rewrites.find((r) => r.source.startsWith('/pb/'));
    const inner = /^\/pb\/:path\((.*)\)$/.exec(pb!.source)![1];
    return new RegExp(`^${inner}$`);
  }

  it('never forwards the /api/ember hook routes', async () => {
    const re = await pbPathPattern();
    for (const p of ['api/ember/qr-login/mint', 'api/ember/qr-login/revoke-all', 'api/ember', 'api/ember/', 'api/admins/auth-with-password']) {
      expect(re.test(p), p).toBe(false);
    }
  });

  it('still forwards the member-facing API', async () => {
    const re = await pbPathPattern();
    for (const p of ['api/collections/users/auth-with-password', 'api/files/x/y/z.png', 'api/realtime', 'api/emberx']) {
      expect(re.test(p), p).toBe(true);
    }
  });
});
