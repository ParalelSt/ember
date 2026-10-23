import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// Accounts are deleted only by the admin route (app/api/admin/users/[id]),
// which also removes the member's private tabs and their files
// (deleteMember in lib/tabStore). PocketBase's default users deleteRule let a member
// delete their own account straight through /pb, skipping that cleanup.
// pocketbase/pb_hooks/ensure_users_rules.pb.js closes it on every boot. The
// live version is G8 in tests/pb-rbac.test.mjs.
const HOOK = join(__dirname, '..', '..', '..', 'pocketbase', 'pb_hooks', 'ensure_users_rules.pb.js');

function boot(users: Record<string, unknown> | null, saveFails = false) {
  let hook: (() => void) | null = null;
  let saved = 0;
  const warnings: string[] = [];
  const dao = {
    findCollectionByNameOrId: () => {
      if (!users) throw new Error('missing');
      return users;
    },
    saveCollection: () => {
      if (saveFails) throw new Error('database is locked');
      saved++;
    },
  };
  vm.runInNewContext(readFileSync(HOOK, 'utf8'), {
    onAfterBootstrap: (fn: () => void) => (hook = fn),
    $app: { dao: () => dao },
    console: { log: () => {}, warn: (m: string) => warnings.push(m) },
  });
  hook!();
  return { saved, warnings };
}

const defaults = () => ({
  listRule: 'id = @request.auth.id',
  viewRule: 'id = @request.auth.id',
  createRule: '@collection.allowed_emails.email ?= email',
  updateRule: 'id = @request.auth.id',
  deleteRule: 'id = @request.auth.id',
});

describe('ensure_users_rules.pb.js', () => {
  it('makes deleting an account server-only, once, and leaves the other rules alone', () => {
    const users = defaults();
    expect(boot(users).saved).toBe(1);
    expect(users).toEqual({ ...defaults(), deleteRule: null });
    expect(boot(users).saved).toBe(0);
  });

  it('never stops the boot', () => {
    expect(() => boot(null)).not.toThrow();
    const r = boot(defaults(), true);
    expect(r.warnings.length).toBe(1);
  });
});
