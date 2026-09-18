// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

class UnauthorizedError extends Error {}
const getOne = vi.fn();
const update = vi.fn();
const requireUserMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET, PATCH } = await import('./route');

function request(body: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

beforeEach(() => {
  getOne.mockReset();
  update.mockReset();
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({
    user: { id: 'u1' },
    pb: { collection: () => ({ getOne, update }) },
  });
  update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
    changelog_seen_version: '0.3.0',
    changelog_hide_new: false,
    ...patch,
  }));
});

describe('GET /api/changelog', () => {
  it('reads the two user fields', async () => {
    getOne.mockResolvedValue({ changelog_seen_version: '0.2.4', changelog_hide_new: true });
    const res = await GET(request(null), undefined as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seenVersion: '0.2.4', hideNew: true });
    expect(getOne).toHaveBeenCalledWith('u1');
  });

  it('reads missing fields as never seen and tags shown', async () => {
    getOne.mockResolvedValue({});
    const res = await GET(request(null), undefined as never);
    expect(await res.json()).toEqual({ seenVersion: '', hideNew: false });
  });

  it('401 without a user', async () => {
    requireUserMock.mockRejectedValue(new UnauthorizedError('no'));
    const res = await GET(request(null), undefined as never);
    expect(res.status).toBe(401);
    expect(getOne).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/changelog', () => {
  it('saves a seen version', async () => {
    const res = await PATCH(request({ seenVersion: '0.3.0' }), undefined as never);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith('u1', { changelog_seen_version: '0.3.0' });
    expect(await res.json()).toEqual({ seenVersion: '0.3.0', hideNew: false });
  });

  it('saves the hide switch alone', async () => {
    const res = await PATCH(request({ hideNew: true }), undefined as never);
    expect(update).toHaveBeenCalledWith('u1', { changelog_hide_new: true });
    expect(await res.json()).toEqual({ seenVersion: '0.3.0', hideNew: true });
  });

  it('saves both at once', async () => {
    await PATCH(request({ seenVersion: '0.3.1', hideNew: false }), undefined as never);
    expect(update).toHaveBeenCalledWith('u1', { changelog_seen_version: '0.3.1', changelog_hide_new: false });
  });

  it('accepts only a version string and a bool', async () => {
    for (const body of [
      { seenVersion: 3 },
      { seenVersion: 'latest' },
      { seenVersion: '' },
      { hideNew: 'yes' },
      { hideNew: 1 },
      { other: true },
      null,
    ]) {
      const res = await PATCH(request(body), undefined as never);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('never writes fields other than the two changelog ones', async () => {
    await PATCH(request({ hideNew: true, is_admin: true, email: 'x@y.z' }), undefined as never);
    expect(update).toHaveBeenCalledWith('u1', { changelog_hide_new: true });
  });

  it('401 without a user', async () => {
    requireUserMock.mockRejectedValue(new UnauthorizedError('no'));
    const res = await PATCH(request({ hideNew: true }), undefined as never);
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });
});
