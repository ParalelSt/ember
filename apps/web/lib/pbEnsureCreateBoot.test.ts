import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// pocketbase/pb_hooks/ensure_pranks.pb.js and ensure_sessions.pb.js create
// their collections on a fresh install's first boot. A failed create (a
// locked database, a rejected schema) must warn and carry on like every
// other ensure_* hook (bughunt X11): a throw from onAfterBootstrap stops
// PocketBase from booting, and with it the whole app.
const HOOKS = join(__dirname, '..', '..', '..', 'pocketbase', 'pb_hooks');

type Def = { name: string; schema?: { name: string }[] };

function boot(file: string, saveFails: boolean) {
  const source = readFileSync(join(HOOKS, file), 'utf8');
  let hook: (() => void) | null = null;
  const warnings: string[] = [];
  const collections = new Map<string, object>();
  function Collection(this: Record<string, unknown>, def: Def) {
    Object.assign(this, def);
    this.id = `id_${def.name}`;
    const fields = def.schema ?? [];
    this.schema = { getFieldByName: (n: string) => fields.find((f) => f.name === n) ?? null };
  }
  collections.set('users', new (Collection as unknown as new (d: Def) => object)({ name: 'users' }));
  collections.set('tracks', new (Collection as unknown as new (d: Def) => object)({ name: 'tracks' }));
  const dao = {
    findCollectionByNameOrId: (name: string) => {
      const c = collections.get(name);
      if (!c) throw new Error('not found');
      return c;
    },
    saveCollection: (c: { name: string }) => {
      if (saveFails) throw new Error('database is locked');
      collections.set(c.name, c);
    },
    findFirstRecordByFilter: () => {
      throw new Error('not found');
    },
    saveRecord: () => {
      if (saveFails) throw new Error('database is locked');
    },
  };
  vm.runInNewContext(source, {
    onAfterBootstrap: (fn: () => void) => (hook = fn),
    $app: { dao: () => dao },
    Collection,
    Record: function Record(this: Record<string, unknown>) {
      this.set = () => {};
    },
    console: { log: () => {}, warn: (m: string) => warnings.push(m) },
  });
  hook!();
  return { names: [...collections.keys()], warnings };
}

describe.each(['ensure_pranks.pb.js', 'ensure_sessions.pb.js'])('%s', (file) => {
  it('warns instead of stopping the boot when a first-time create fails', () => {
    let result: ReturnType<typeof boot> | null = null;
    expect(() => (result = boot(file, true))).not.toThrow();
    expect(result!.warnings.length).toBeGreaterThan(0);
    expect(result!.names).toEqual(['users', 'tracks']);
  });

  it('still creates every collection when the saves work', () => {
    const { names, warnings } = boot(file, false);
    expect(warnings).toEqual([]);
    const expected =
      file === 'ensure_pranks.pb.js'
        ? ['prank_sounds', 'prank_schedules', 'pranks', 'app_settings']
        : ['sessions', 'session_tracks', 'session_commands', 'session_members'];
    for (const n of expected) expect(names, n).toContain(n);
  });
});
