// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
import { REQUIRED_WEB } from '@/lib/update/required';
const { GET } = await import('./route');

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/version', () => {
  it('says which Ember this server runs', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.7.31 (a1b2c3d 2026-10-22)');
    const res = await GET({} as NextRequest, {} as never);
    expect(await res.json()).toEqual({ version: '0.7.31 (a1b2c3d 2026-10-22)', requiredWeb: REQUIRED_WEB });
  });

  it('says the oldest web build clients may run, from the constant in code (no env switch)', async () => {
    vi.stubEnv('EMBER_REQUIRED_WEB', '9.9.9');
    const res = await GET({} as NextRequest, {} as never);
    expect((await res.json()).requiredWeb).toBe('0.7.52');
  });
});
