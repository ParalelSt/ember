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

// The same rule for every other hook that creates a collection on a fresh
// install, and for ensure_admin re-promoting the owner: a failed save warns
// and the boot goes on.
type Field = { name: string; options?: Record<string, unknown> };
type Def2 = { name: string; schema?: Field[]; indexes?: string[] };

function bootAny(file: string, saveFails: boolean) {
  const source = readFileSync(join(HOOKS, file), 'utf8');
  const hooks: (() => void)[] = [];
  const warnings: string[] = [];
  const collections = new Map<string, Record<string, unknown>>();
  function Collection(this: Record<string, unknown>, def: Def2) {
    Object.assign(this, def);
    this.id = `id_${def.name}`;
    this.indexes = def.indexes ?? [];
    const fields: Field[] = [...(def.schema ?? [])];
    this.schema = {
      getFieldByName: (n: string) => fields.find((f) => f.name === n) ?? null,
      addField: (f: Field) => fields.push(f),
    };
  }
  const make = (def: Def2) => new (Collection as unknown as new (d: Def2) => Record<string, unknown>)(def);
  for (const name of ['users', 'tracks', 'playlists', 'playlist_tracks']) collections.set(name, make({ name }));
  const owner = { get: () => false, set: () => {} };
  const dao = {
    findCollectionByNameOrId: (name: string) => {
      const c = collections.get(name);
      if (!c) throw new Error('not found');
      return c;
    },
    saveCollection: (c: { name: string }) => {
      if (saveFails) throw new Error('database is locked');
      collections.set(c.name, c as Record<string, unknown>);
    },
    findAuthRecordByEmail: () => owner,
    saveRecord: () => {
      if (saveFails) throw new Error('database is locked');
    },
  };
  const noop = () => {};
  vm.runInNewContext(source, {
    onAfterBootstrap: (fn: () => void) => hooks.push(fn),
    onRecordBeforeCreateRequest: noop,
    onRecordBeforeUpdateRequest: noop,
    onModelBeforeCreate: noop,
    $app: { dao: () => dao },
    $os: { getenv: (k: string) => (k === 'EMBER_ADMIN_EMAIL' ? 'owner@x.test' : '') },
    Collection,
    SchemaField: function SchemaField(this: Record<string, unknown>, f: Field) {
      Object.assign(this, f);
    },
    console: { log: () => {}, warn: (m: string) => warnings.push(m) },
  });
  for (const h of hooks) h();
  return { names: [...collections.keys()], warnings };
}

describe.each([
  ['ensure_collab_playlists.pb.js', ['playlist_members']],
  ['ensure_imports.pb.js', ['import_jobs', 'import_items']],
  ['ensure_recent_searches.pb.js', ['recent_searches']],
  ['ensure_tabs.pb.js', ['tabs', 'tab_lookups']],
  ['ensure_themes.pb.js', ['themes']],
  ['ensure_uploads.pb.js', ['uploads']],
  ['ensure_admin.pb.js', []],
])('%s', (file, created) => {
  it('warns instead of stopping the boot when a save fails', () => {
    let result: ReturnType<typeof bootAny> | null = null;
    expect(() => (result = bootAny(file, true))).not.toThrow();
    expect(result!.warnings.length).toBeGreaterThan(0);
    for (const n of created) expect(result!.names).not.toContain(n);
  });

  it('still creates its collections when the saves work', () => {
    const { names, warnings } = bootAny(file, false);
    expect(warnings).toEqual([]);
    for (const n of created) expect(names, n).toContain(n);
  });
});
