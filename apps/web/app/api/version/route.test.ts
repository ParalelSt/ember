// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/version', () => {
  it('says which Ember this server runs', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.7.31 (a1b2c3d 2026-10-22)');
    expect(await GET().json()).toEqual({ version: '0.7.31 (a1b2c3d 2026-10-22)' });
  });
});
