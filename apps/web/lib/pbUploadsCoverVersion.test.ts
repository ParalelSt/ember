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
