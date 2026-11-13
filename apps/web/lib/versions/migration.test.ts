// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/** pocketbase/pb_migrations/1793000000_user_devices.js in a stand-in for
 *  PocketBase's runtime. The real one was run against a throwaway data dir;
 *  this keeps the part that matters from drifting: nobody gets near the rows
 *  through the public /pb proxy. */

const SOURCE = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'pocketbase', 'pb_migrations', '1793000000_user_devices.js'),
  'utf8',
);

type Def = {
  name: string;
  schema: { name: string; type: string; required: boolean; options: Record<string, unknown> }[];
  indexes: string[];
} & Record<string, unknown>;

function load() {
  let up: ((db: unknown) => unknown) | null = null;
  let down: ((db: unknown) => unknown) | null = null;
  const saved: Def[] = [];
  const deleted: unknown[] = [];
  vm.runInNewContext(SOURCE, {
    migrate: (u: (db: unknown) => unknown, d: (db: unknown) => unknown) => {
      up = u;
      down = d;
    },
    Dao: class {
      findCollectionByNameOrId(name: string) {
        return { id: `${name}_id`, name };
      }
      saveCollection(c: Def) {
        saved.push(c);
      }
      deleteCollection(c: unknown) {
        deleted.push(c);
      }
    },
    Collection: class {
      constructor(cfg: Record<string, unknown>) {
        Object.assign(this, cfg);
      }
    },
  });
  return { up: up!, down: down!, saved, deleted };
}

describe('1793000000_user_devices', () => {
  it('is superuser only: every rule null', () => {
    const { up, saved } = load();
    up({});
    const c = saved[0];
    expect(c.name).toBe('user_devices');
    for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) {
      expect(c[rule]).toBeNull();
    }
  });

  it('holds one row per member and device, gone with the member', () => {
    const { up, saved } = load();
    up({});
    const c = saved[0];
    expect(c.indexes).toEqual([expect.stringMatching(/UNIQUE INDEX .* ON user_devices \(user, device_key\)/)]);
    const user = c.schema.find((f) => f.name === 'user')!;
    expect(user.options).toMatchObject({ collectionId: 'users_id', maxSelect: 1, cascadeDelete: true });
  });

  it('stores only the six fields it says, with bounded lengths', () => {
    const { up, saved } = load();
    up({});
    const c = saved[0];
    expect(c.schema.map((f) => f.name)).toEqual(['user', 'device_key', 'platform', 'shell_version', 'web_version', 'last_seen']);
    for (const name of ['shell_version', 'web_version']) {
      expect(c.schema.find((f) => f.name === name)!.options.max).toBe(40);
    }
    expect(c.schema.find((f) => f.name === 'device_key')!.options).toMatchObject({ min: 8, max: 64 });
  });

  it('can be taken back', () => {
    const { down, deleted } = load();
    down({});
    expect(deleted).toHaveLength(1);
  });
});
