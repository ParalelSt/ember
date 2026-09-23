// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const update = vi.fn();

vi.mock('@/lib/auth', () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  requireUser: async () => ({
    user: { id: 'u1', email: 'a@b.c' },
    // Same rationale as the admin/users route test: `files.getURL()` on the
    // server client bakes in the internal POCKETBASE_URL, which is the bug.
    // The route must use the `fileUrl()` helper instead.
    pb: {
      collection: () => ({ update: (id: string, patch: unknown) => update(id, patch) }),
      files: { getURL: () => 'http://127.0.0.1:8090/api/files/users/u1/avatar.png' },
    },
  }),
}));

vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { PATCH } = await import('./route');

function request(form: FormData): NextRequest {
  return { formData: async () => form } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/profile', () => {
  it('returns a same-origin /pb avatar URL after an avatar upload, not the internal server URL', async () => {
    update.mockResolvedValue({
      id: 'u1', collectionId: 'col_users', collectionName: 'users',
      email: 'a@b.c', name: 'Robin', avatar: 'avatar.png',
    });
    const form = new FormData();
    form.set('avatar', new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' }));

    const res = await PATCH(request(form), undefined as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.avatarUrl).toBe('/pb/api/files/col_users/u1/avatar.png');
  });

  it('returns null avatarUrl when the update leaves no avatar', async () => {
    update.mockResolvedValue({
      id: 'u1', collectionId: 'col_users', collectionName: 'users',
      email: 'a@b.c', name: 'Robin', avatar: '',
    });
    const form = new FormData();
    form.set('removeAvatar', 'true');

    const body = await (await PATCH(request(form), undefined as never)).json();

    expect(body.user.avatarUrl).toBeNull();
  });

  it('[bughunt W13] answers 400, not a 500, when the body is JSON instead of a form', async () => {
    const jsonReq = {
      formData: async () => {
        throw new TypeError('Could not parse content as FormData.');
      },
    } as unknown as NextRequest;

    const res = await PATCH(jsonReq, undefined as never);

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
