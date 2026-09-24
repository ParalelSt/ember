// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type PocketBase from 'pocketbase';
import { fakePocketBase } from '@/test-utils/fakePocketBase';
import { repoFor } from '@/lib/theme/themesRepo';
import { PRESET_BY_ID } from '@/lib/theme/presets';

const MIDNIGHT = PRESET_BY_ID.midnight.inputs;

/** The fake, with every call's options recorded. */
function recording() {
  const fake = fakePocketBase({
    users: [{ id: 'u1', name: 'Aron' }, { id: 'u2', name: '' }],
    themes: [
      { id: 't1', owner: 'u1', name: 'Mine', base: 'midnight', inputs: MIDNIGHT, shared: true, updated: '2' },
      { id: 't2', owner: 'u2', name: 'Theirs', base: 'midnight', inputs: MIDNIGHT, shared: true, updated: '3' },
      { id: 't3', owner: 'u2', name: 'Broken', base: 'midnight', inputs: { nope: 1 }, shared: true, updated: '4' },
    ],
  });
  const options: unknown[] = [];
  const pb = {
    filter: fake.pb.filter.bind(fake.pb),
    collection: (name: string) => {
      const c = fake.pb.collection(name) as unknown as Record<string, (...a: unknown[]) => unknown>;
      return new Proxy(c, {
        get: (target, prop: string) => (...args: unknown[]) => {
          options.push(args[args.length - 1]);
          return target[prop]!(...args);
        },
      });
    },
  } as unknown as PocketBase;
  return { repo: repoFor(pb), options };
}

describe('repoFor', () => {
  it('turns off auto-cancellation on every call, so parallel reads never cancel each other', async () => {
    const { repo, options } = recording();
    await Promise.all([repo.listMine('u1'), repo.listShared('u1'), repo.get('t1'), repo.countMine('u1')]);
    const created = await repo.create({ owner: 'u1', name: 'New', base: 'mono', inputs: MIDNIGHT, shared: false });
    await repo.update(created.id, { name: 'Newer' });
    await repo.remove(created.id);
    expect(options).toHaveLength(7);
    for (const opts of options) expect(opts).toMatchObject({ requestKey: null });
  });

  it("labels shared rows with the creator's name and skips unreadable rows", async () => {
    const { repo } = recording();
    const shared = await repo.listShared('u1');
    expect(shared.map((t) => [t.id, t.ownerName])).toEqual([['t2', 'Someone']]);
    expect(await repo.get('t3')).toBeNull();
    expect(await repo.get('missing')).toBeNull();
    expect(await repo.countMine('u1')).toBe(1);
  });
});
