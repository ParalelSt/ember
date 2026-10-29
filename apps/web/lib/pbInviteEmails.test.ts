import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// PocketBase 0.22 compares emails as written: an invite saved in the admin UI
// as "Ana@Example.com" never matched the lower-cased address the sign-in
// page sends (check-email's filter and the users createRule are both
// case-sensitive), so the person read "isn't on the invite list".
// pocketbase/pb_hooks/ensure_invite_emails.pb.js lower-cases every save and
// the rows already stored.
const HOOK = join(__dirname, '..', '..', '..', 'pocketbase', 'pb_hooks', 'ensure_invite_emails.pb.js');

class FakeRecord {
  constructor(public data: Record<string, unknown>) {}
  get(k: string) {
    return this.data[k];
  }
  set(k: string, v: unknown) {
    this.data[k] = v;
  }
}

function load(rows: FakeRecord[] | null, failSave = false) {
  const hooks: Record<string, { fn: (e: unknown) => void; tag?: string }> = {};
  const saved: string[] = [];
  const deleted: string[] = [];
  const warnings: string[] = [];
  const dao = {
    findRecordsByFilter: (collection: string) => {
      if (collection !== 'allowed_emails' || !rows) throw new Error('missing collection');
      return rows;
    },
    saveRecord: (r: FakeRecord) => {
      if (failSave) throw new Error('database is locked');
      saved.push(String(r.get('email')));
    },
    deleteRecord: (r: FakeRecord) => deleted.push(String(r.get('email'))),
  };
  // Run in a fresh context with only what PocketBase hands a hook, so a
  // handler that reached for a top-level helper would fail here too.
  vm.runInNewContext(readFileSync(HOOK, 'utf8'), {
    onModelBeforeCreate: (fn: (e: unknown) => void, tag: string) => (hooks.create = { fn, tag }),
    onModelBeforeUpdate: (fn: (e: unknown) => void, tag: string) => (hooks.update = { fn, tag }),
    onAfterBootstrap: (fn: (e: unknown) => void) => (hooks.boot = { fn }),
    $app: { dao: () => dao },
    console: { log: () => {}, warn: (m: string) => warnings.push(m) },
  });
  return { hooks, saved, deleted, warnings };
}

/** A handler as PocketBase runs it: on its own, without the file's scope. */
function runIsolated(fn: (e: unknown) => void, e: unknown) {
  vm.runInNewContext(`(${fn.toString()})(e)`, { e, String });
}

describe('ensure_invite_emails.pb.js', () => {
  it('lower-cases an invite saved with capitals, on create and on update, for allowed_emails only', () => {
    const { hooks } = load([]);
    expect(hooks.create.tag).toBe('allowed_emails');
    expect(hooks.update.tag).toBe('allowed_emails');
    const made = new FakeRecord({ email: ' Ana@Example.COM' });
    runIsolated(hooks.create.fn, { model: made });
    expect(made.get('email')).toBe('ana@example.com');
    const edited = new FakeRecord({ email: 'Bo@Example.com' });
    runIsolated(hooks.update.fn, { model: edited });
    expect(edited.get('email')).toBe('bo@example.com');
  });

  it('brings stored invites in line on boot, drops a capitalised twin, and leaves a lower-case list alone', () => {
    const rows = [
      new FakeRecord({ email: 'ana@example.com' }),
      new FakeRecord({ email: 'Ana@Example.com' }),
      new FakeRecord({ email: 'Luka@Example.com' }),
    ];
    const first = load(rows);
    first.hooks.boot.fn({});
    expect(first.saved).toEqual(['luka@example.com']);
    expect(first.deleted).toEqual(['Ana@Example.com']);

    const again = load([new FakeRecord({ email: 'ana@example.com' }), new FakeRecord({ email: 'luka@example.com' })]);
    again.hooks.boot.fn({});
    expect(again.saved).toEqual([]);
    expect(again.deleted).toEqual([]);
  });

  it('never stops the boot', () => {
    const missing = load(null);
    expect(() => missing.hooks.boot.fn({})).not.toThrow();
    const locked = load([new FakeRecord({ email: 'Ana@Example.com' })], true);
    expect(() => locked.hooks.boot.fn({})).not.toThrow();
    expect(locked.warnings).toHaveLength(1);
  });
});
