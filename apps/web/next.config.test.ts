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
