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

/** A tiny users row: getOne reads it, update merges into it. */
let row: Record<string, unknown>;

beforeEach(() => {
  row = {};
  getOne.mockReset();
  update.mockReset();
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({
    user: { id: 'u1' },
    pb: { collection: () => ({ getOne, update }) },
  });
  getOne.mockImplementation(async () => ({ ...row }));
  update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
    row = { ...row, ...patch };
    return { ...row };
  });
});

describe('GET /api/plugins', () => {
  it('reads the stored switches', async () => {
    row = { plugins: { partyVolume: true, tabsEnabled: false } };
    const res = await GET(request(null), undefined as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ partyVolume: true, tabsEnabled: false });
    expect(getOne).toHaveBeenCalledWith('u1');
  });

  it('leaves out keys never saved, junk values and unknown keys', async () => {
    row = { plugins: { tabsEnabled: 'yes', other: true } };
    expect(await (await GET(request(null), undefined as never)).json()).toEqual({});
    row = { plugins: null };
    expect(await (await GET(request(null), undefined as never)).json()).toEqual({});
    row = {};
    expect(await (await GET(request(null), undefined as never)).json()).toEqual({});
  });

  it('401 without a user', async () => {
    requireUserMock.mockRejectedValue(new UnauthorizedError('no'));
    const res = await GET(request(null), undefined as never);
    expect(res.status).toBe(401);
    expect(getOne).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/plugins', () => {
  it('saves one switch and merges it into what is stored', async () => {
    row = { plugins: { partyVolume: true, futurePlugin: true } };
    const res = await PATCH(request({ tabsEnabled: false }), undefined as never);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith('u1', { plugins: { partyVolume: true, futurePlugin: true, tabsEnabled: false } });
    expect(await res.json()).toEqual({ partyVolume: true, tabsEnabled: false });
  });

  it('round trips: a PATCH is what the next GET returns', async () => {
    await PATCH(request({ partyVolume: true, tabsEnabled: false }), undefined as never);
    expect(await (await GET(request(null), undefined as never)).json()).toEqual({ partyVolume: true, tabsEnabled: false });
    await PATCH(request({ tabsEnabled: true }), undefined as never);
    expect(await (await GET(request(null), undefined as never)).json()).toEqual({ partyVolume: true, tabsEnabled: true });
  });

  it('400 for an unknown key, a non-boolean, or nothing', async () => {
    for (const body of [
      { other: true },
      { tabsEnabled: false, other: true },
      { tabsEnabled: 'false' },
      { partyVolume: 1 },
      { partyVolume: null },
      {},
      [],
      'tabsEnabled',
      null,
    ]) {
      const res = await PATCH(request(body), undefined as never);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('saves the equalizer beside the switches, clamped, and keeps it on a later switch PATCH', async () => {
    row = { plugins: { tabsEnabled: true } };
    const res = await PATCH(request({ equalizer: { enabled: true, bands: [20, 0, 0, 0, -3] } }), undefined as never);
    expect(res.status).toBe(200);
    const eq = { enabled: true, bands: [12, 0, 0, 0, -3] };
    expect(await res.json()).toEqual({ tabsEnabled: true, equalizer: eq });
    await PATCH(request({ partyVolume: true }), undefined as never);
    expect(await (await GET(request(null), undefined as never)).json()).toEqual({
      tabsEnabled: true,
      partyVolume: true,
      equalizer: eq,
    });
  });

  it('400 for equalizer settings that are not settings', async () => {
    for (const equalizer of [true, { enabled: true }, { enabled: true, bands: [0, 0, 0] }]) {
      const res = await PATCH(request({ equalizer }), undefined as never);
      expect(res.status, JSON.stringify(equalizer)).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('never writes a field other than plugins', async () => {
    const res = await PATCH(request({ tabsEnabled: true, is_admin: true }), undefined as never);
    expect(res.status).toBe(400);
    await PATCH(request({ tabsEnabled: true }), undefined as never);
    expect(Object.keys(update.mock.calls[0][1])).toEqual(['plugins']);
  });

  it('401 without a user', async () => {
    requireUserMock.mockRejectedValue(new UnauthorizedError('no'));
    const res = await PATCH(request({ tabsEnabled: true }), undefined as never);
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });
});
