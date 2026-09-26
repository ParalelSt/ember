// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-token-'));
const {
  _resetStreamTokenSecret,
  isSignableTrackId,
  secretFilePath,
  signStreamToken,
  streamTokenUser,
  STREAM_TOKEN_TTL_SEC,
  verifyStreamToken,
} = await import('./streamToken');

const YT = 'youtube:dQw4w9WgXcQ';
const UP = 'upload:abc123def456ghi';

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('MUSIC_DIR', dir);
  vi.stubEnv('STREAM_TOKEN_SECRET', 'x'.repeat(40));
  _resetStreamTokenSecret();
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('stream tokens: sign and verify', () => {
  it('a fresh token names its member for its own track and use', () => {
    const { token, expiresAt } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream' });
    expect(verifyStreamToken(token, { trackId: YT, scope: 'stream' })).toEqual({ userId: 'u1' });
    expect(expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(STREAM_TOKEN_TTL_SEC - 5);
  });

  it('lives six hours, never longer, whatever ttl is asked for', () => {
    const now = Date.UTC(2026, 8, 26, 12);
    const { token, expiresAt } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream', nowMs: now, ttlSec: 999_999 });
    expect(expiresAt).toBe(now / 1000 + 6 * 3600);
    expect(verifyStreamToken(token, { trackId: YT, scope: 'stream', nowMs: now + 6 * 3600_000 - 1000 })).not.toBeNull();
  });

  it('an expired token is refused', () => {
    const now = Date.UTC(2026, 8, 26, 12);
    const { token } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream', nowMs: now });
    expect(verifyStreamToken(token, { trackId: YT, scope: 'stream', nowMs: now + 6 * 3600_000 })).toBeNull();
    expect(verifyStreamToken(token, { trackId: YT, scope: 'stream', nowMs: now + 7 * 3600_000 })).toBeNull();
  });

  it('a token for another track is refused', () => {
    const { token } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream' });
    expect(verifyStreamToken(token, { trackId: 'youtube:aaaaaaaaaaa', scope: 'stream' })).toBeNull();
    expect(verifyStreamToken(token, { trackId: UP, scope: 'stream' })).toBeNull();
  });

  it('a token for another use is refused (stream is not art, and the other way round)', () => {
    const stream = signStreamToken({ trackId: UP, userId: 'u1', scope: 'stream' }).token;
    const art = signStreamToken({ trackId: UP, userId: 'u1', scope: 'art' }).token;
    expect(verifyStreamToken(stream, { trackId: UP, scope: 'art' })).toBeNull();
    expect(verifyStreamToken(art, { trackId: UP, scope: 'stream' })).toBeNull();
  });

  it('tampering with the claims breaks the signature', () => {
    const { token } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream' });
    const [payload, sig] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    for (const change of [{ u: 'admin' }, { t: 'youtube:aaaaaaaaaaa' }, { e: claims.e + 3600 }, { s: 'art' }]) {
      const forged = Buffer.from(JSON.stringify({ ...claims, ...change })).toString('base64url');
      const want = { trackId: change.t ?? YT, scope: (change.s ?? 'stream') as 'stream' | 'art' };
      expect(verifyStreamToken(`${forged}.${sig}`, want)).toBeNull();
    }
  });

  it('a tampered or truncated signature is refused', () => {
    const { token } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream' });
    const [payload, sig] = token.split('.');
    const flipped = sig.slice(0, -2) + (sig.at(-2) === 'A' ? 'B' : 'A') + sig.at(-1);
    expect(verifyStreamToken(`${payload}.${flipped}`, { trackId: YT, scope: 'stream' })).toBeNull();
    expect(verifyStreamToken(`${payload}.${sig.slice(0, 10)}`, { trackId: YT, scope: 'stream' })).toBeNull();
    expect(verifyStreamToken(`${payload}.`, { trackId: YT, scope: 'stream' })).toBeNull();
    expect(verifyStreamToken(payload, { trackId: YT, scope: 'stream' })).toBeNull();
    expect(verifyStreamToken(`${token}.x`, { trackId: YT, scope: 'stream' })).toBeNull();
  });

  it('a token signed with another secret is refused', () => {
    const { token } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream' });
    vi.stubEnv('STREAM_TOKEN_SECRET', 'y'.repeat(40));
    _resetStreamTokenSecret();
    expect(verifyStreamToken(token, { trackId: YT, scope: 'stream' })).toBeNull();
  });

  it('garbage never throws', () => {
    for (const t of [null, undefined, '', '.', 'a.b', '%%%.%%%', 'x'.repeat(5000), '{}.{}']) {
      expect(verifyStreamToken(t, { trackId: YT, scope: 'stream' })).toBeNull();
    }
  });

  it('only YouTube videos and uploads can be signed', () => {
    expect(isSignableTrackId(YT)).toBe(true);
    expect(isSignableTrackId(UP)).toBe(true);
    for (const bad of ['jamendo:1', 'youtube:short', 'upload:../x', 'upload:a"b', '', 42, null]) {
      expect(isSignableTrackId(bad)).toBe(false);
    }
    expect(() => signStreamToken({ trackId: 'upload:../../etc', userId: 'u1', scope: 'stream' })).toThrow();
    expect(() => signStreamToken({ trackId: YT, userId: 'bad id', scope: 'stream' })).toThrow();
  });

  it('streamTokenUser reads the st parameter of a request', () => {
    const { token } = signStreamToken({ trackId: YT, userId: 'u9', scope: 'stream' });
    const req = new Request(`http://h/api/youtube/stream/dQw4w9WgXcQ?st=${encodeURIComponent(token)}`);
    expect(streamTokenUser(req, YT, 'stream')).toBe('u9');
    expect(streamTokenUser(new Request('http://h/api/youtube/stream/dQw4w9WgXcQ'), YT, 'stream')).toBeNull();
  });
});

describe('stream tokens: the secret', () => {
  it('without STREAM_TOKEN_SECRET a secret is generated once, kept on disk (0600) and reused', () => {
    vi.stubEnv('STREAM_TOKEN_SECRET', '');
    _resetStreamTokenSecret();
    fs.rmSync(secretFilePath(), { force: true });
    const { token } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream' });
    expect(fs.existsSync(secretFilePath())).toBe(true);
    expect(fs.statSync(secretFilePath()).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(secretFilePath(), 'utf8').length).toBeGreaterThanOrEqual(64);
    // A restart reads the same secret back: links made before it still play.
    _resetStreamTokenSecret();
    expect(verifyStreamToken(token, { trackId: YT, scope: 'stream' })).toEqual({ userId: 'u1' });
  });

  it('an empty or cut-short secret file is replaced, and the new one is kept', () => {
    vi.stubEnv('STREAM_TOKEN_SECRET', '');
    for (const junk of ['', 'abc']) {
      fs.writeFileSync(secretFilePath(), junk, { mode: 0o644 });
      _resetStreamTokenSecret();
      const { token } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream' });
      const kept = fs.readFileSync(secretFilePath(), 'utf8');
      expect(kept.length).toBeGreaterThanOrEqual(64);
      expect(fs.statSync(secretFilePath()).mode & 0o777).toBe(0o600);
      _resetStreamTokenSecret();
      expect(verifyStreamToken(token, { trackId: YT, scope: 'stream' })).toEqual({ userId: 'u1' });
    }
  });

  it('a too-short STREAM_TOKEN_SECRET is not used', () => {
    vi.stubEnv('STREAM_TOKEN_SECRET', 'short');
    _resetStreamTokenSecret();
    const { token } = signStreamToken({ trackId: YT, userId: 'u1', scope: 'stream' });
    // Same result as the generated secret on disk.
    vi.stubEnv('STREAM_TOKEN_SECRET', '');
    _resetStreamTokenSecret();
    expect(verifyStreamToken(token, { trackId: YT, scope: 'stream' })).toEqual({ userId: 'u1' });
  });
});
