// @vitest-environment node
/** The stream and cover routes read an upload's row on every request (each
 *  Range request of a play, every cover in a list of uploads): one admin
 *  sign-in for all of them, not a password check each. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pb = vi.hoisted(() => ({
  logins: 0,
  rows: new Map<string, { id: string }>(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock('pocketbase', () => ({
  default: class {
    authStore = {
      token: '',
      save(token: string) {
        this.token = token;
      },
    };
    collection(name: string) {
      return {
        authWithPassword: async () => {
          pb.logins += 1;
          this.authStore.save(`token-${pb.logins}`);
        },
        getOne: async (id: string) => {
          const row = name === 'uploads' ? pb.rows.get(id) : undefined;
          if (!row) throw Object.assign(new Error('not found'), { status: 404 });
          return row;
        },
      };
    }
  },
}));

process.env.POCKETBASE_ADMIN_EMAIL = 'admin@example.test';
process.env.POCKETBASE_ADMIN_PASSWORD = 'secret';
const { readUpload } = await import('./record');

beforeEach(() => {
  pb.logins = 0;
  pb.rows = new Map([['up1', { id: 'up1' }], ['up2', { id: 'up2' }]]);
});

describe('readUpload', () => {
  it('signs in as admin once for many requests', async () => {
    for (let i = 0; i < 20; i += 1) expect(await readUpload(i % 2 ? 'up1' : 'up2')).toMatchObject({ id: i % 2 ? 'up1' : 'up2' });
    expect(pb.logins).toBeLessThanOrEqual(1);
  });

  it('asks a fresh login before calling an upload missing', async () => {
    await readUpload('up1');
    const before = pb.logins;
    expect(await readUpload('gone')).toBeNull();
    expect(pb.logins).toBe(before + 1);
  });
});
