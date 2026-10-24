// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/** pocketbase/pb_hooks/ensure_radio_favorites.pb.js, run in a stand-in for
 *  PocketBase's JS runtime: it creates the collection with owner-only rules
 *  once, leaves an existing one alone, and a failed save only warns (it must
 *  never stop PocketBase from booting). */

const HOOK = readFileSync(join(__dirname, '..', '..', '..', '..', 'pocketbase', 'pb_hooks', 'ensure_radio_favorites.pb.js'), 'utf8');

function boot(opts: { exists?: boolean; usersMissing?: boolean; saveThrows?: boolean } = {}) {
  const saved: Record<string, unknown>[] = [];
  const warn = vi.fn();
  const dao = {
    findCollectionByNameOrId: (name: string) => {
      if (name === 'radio_favorites' && opts.exists) return { name };
      if (name === 'users' && !opts.usersMissing) return { id: 'users_id', name };
      throw new Error(`no ${name}`);
    },
    saveCollection: (c: Record<string, unknown>) => {
      if (opts.saveThrows) throw new Error('disk full');
      saved.push(c);
    },
  };
  let bootstrap: ((e: unknown) => void) | null = null;
  vm.runInNewContext(HOOK, {
    onAfterBootstrap: (fn: (e: unknown) => void) => { bootstrap = fn; },
    $app: { dao: () => dao },
    Collection: class { constructor(cfg: Record<string, unknown>) { Object.assign(this, cfg); } },
    console: { log: vi.fn(), warn },
  });
  expect(bootstrap).toBeTypeOf('function');
  bootstrap!({});
  return { saved, warn };
}

describe('ensure_radio_favorites.pb.js', () => {
  it('creates radio_favorites with owner-only rules and no edits', () => {
    const { saved } = boot();
    expect(saved).toHaveLength(1);
    const c = saved[0] as Record<string, unknown> & { schema: { name: string; options?: Record<string, unknown> }[]; indexes: string[] };
    expect(c.name).toBe('radio_favorites');
    expect(c.listRule).toBe('user = @request.auth.id');
    expect(c.viewRule).toBe('user = @request.auth.id');
    expect(c.createRule).toBe('@request.auth.id != "" && user = @request.auth.id');
    expect(c.updateRule).toBeNull();
    expect(c.deleteRule).toBe('user = @request.auth.id');
    expect(c.schema.map((f) => f.name)).toEqual(['user', 'station_id', 'name', 'url', 'favicon', 'added']);
    expect(c.schema[0].options).toMatchObject({ collectionId: 'users_id', maxSelect: 1, cascadeDelete: true });
    expect(c.indexes.some((i) => /UNIQUE INDEX .* \(user, station_id\)/.test(i))).toBe(true);
  });

  it('leaves an existing collection alone', () => {
    expect(boot({ exists: true }).saved).toHaveLength(0);
  });

  it('skips quietly without a users collection, and only warns when the save fails', () => {
    expect(boot({ usersMissing: true }).saved).toHaveLength(0);
    const { warn } = boot({ saveThrows: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not create radio_favorites'));
  });
});
