import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// pocketbase/pb_hooks/ensure_uploads_cover_version.pb.js adds the `artwork_v`
// number the cover routes bump. Run it against a stand-in dao: it must add
// the field once, leave everything else alone, and never stop the boot.
const HOOK = readFileSync(
  join(__dirname, '..', '..', '..', 'pocketbase', 'pb_hooks', 'ensure_uploads_cover_version.pb.js'),
  'utf8',
);

function boot(collection: { schema: { fields: { name: string }[] } } | null, saveFails = false) {
  let hook: (() => void) | null = null;
  let saved = 0;
  const schema = collection && {
    getFieldByName: (n: string) => collection.schema.fields.find((f) => f.name === n) ?? null,
    addField: (f: { name: string }) => collection.schema.fields.push(f),
  };
  const dao = {
    findCollectionByNameOrId: () => {
      if (!collection) throw new Error('missing');
      return { schema };
    },
    saveCollection: () => {
      if (saveFails) throw new Error('db locked');
      saved++;
    },
  };
  vm.runInNewContext(HOOK, {
    onAfterBootstrap: (fn: () => void) => (hook = fn),
    $app: { dao: () => dao },
    SchemaField: function SchemaField(this: object, o: object) { Object.assign(this, o); },
    console: { log: () => {}, warn: () => {} },
  });
  hook!();
  return { saved };
}

describe('ensure_uploads_cover_version.pb.js', () => {
  it('adds an optional artwork_v number to uploads, once', () => {
    const uploads = { schema: { fields: [{ name: 'title' }, { name: 'artwork_ext' }] } };
    expect(boot(uploads).saved).toBe(1);
    expect(uploads.schema.fields.map((f) => f.name)).toEqual(['title', 'artwork_ext', 'artwork_v']);
    expect(uploads.schema.fields[2]).toMatchObject({ type: 'number', required: false });
    expect(boot(uploads).saved).toBe(0);
    expect(uploads.schema.fields).toHaveLength(3);
  });

  it('skips quietly when the collection is missing or the save fails', () => {
    expect(() => boot(null)).not.toThrow();
    expect(() => boot({ schema: { fields: [] } }, true)).not.toThrow();
  });
});

// PocketBase 0.22 runs the hook files in no fixed order (it reads them into a
// Go map), so on a fresh install this hook can run before ensure_uploads has
// made the collection and skip. ensure_uploads must then create the field
// itself, or a cover changed by hand keeps its old, year-cached URL until the
// next restart.
describe('ensure_uploads.pb.js on a fresh install', () => {
  it('creates uploads with artwork_v already in it', () => {
    let hook: (() => void) | null = null;
    let created: { schema: { name: string; type: string }[] } | null = null;
    const dao = {
      findCollectionByNameOrId: (name: string) => {
        if (name === 'users') return { id: 'users_id' };
        throw new Error('missing');
      },
      saveCollection: (c: typeof created) => (created = c),
    };
    vm.runInNewContext(
      readFileSync(join(__dirname, '..', '..', '..', 'pocketbase', 'pb_hooks', 'ensure_uploads.pb.js'), 'utf8'),
      {
        onAfterBootstrap: (fn: () => void) => (hook = fn),
        $app: { dao: () => dao },
        Collection: function Collection(this: object, o: object) { Object.assign(this, o); },
        console: { log: () => {}, warn: () => {} },
      },
    );
    hook!();
    expect(created!.schema.find((f) => f.name === 'artwork_v')).toMatchObject({ type: 'number', required: false });
  });
});
