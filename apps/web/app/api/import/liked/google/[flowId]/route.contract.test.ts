// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';
import { googleLikesErrorMessage } from '@/lib/import/transferCopy';

// The route and the app's helper together: the real route answers, and
// api.googleLikesStatus reads that answer the way the Transfer dialog does.

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ user: { id: 'u1' }, pb: {} }),
  verifiedUserId: async () => 'u1',
  UnauthorizedError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/logger/server', () => {
  const log = () => {};
  return { serverLogger: { error: log, warn: log, info: log }, requestContext: { run: (_c: unknown, fn: () => unknown) => fn() } };
});
vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { GET } = await import('./route');
const { api } = await import('@/lib/api');
const { logger } = await import('@/lib/logger/client');

const req = { method: 'GET', url: 'http://127.0.0.1/api/import/liked/google/x', headers: new Headers() } as unknown as NextRequest;

describe('GET /api/import/liked/google/:flowId + api.googleLikesStatus', () => {
  it('a sign-in that is over says so in words, and files no bug report', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => GET(req, { params: Promise.resolve({ flowId: 'x'.repeat(24) }) })));
    const e = await api.googleLikesStatus('x'.repeat(24)).catch((err: unknown) => err);
    expect(e).toMatchObject({ status: 404 });
    expect(googleLikesErrorMessage(e)).toBe(GOOGLE_MESSAGES.gone);
    expect(logger.error).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
