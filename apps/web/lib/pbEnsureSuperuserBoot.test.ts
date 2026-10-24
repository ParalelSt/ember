import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// pocketbase/pb_hooks/ensure_superuser.pb.js runs on every boot. On a brand
// new pb_data (start-static.sh only runs `serve`), PocketBase fires the boot
// hooks before it has made its own tables, so every dao call throws. The
// superuser count used to sit outside any try, and its throw stopped
// PocketBase from booting at all. The live version of this is S5 in
// tests/pb-hooks-credentials.test.mjs.
const HOOK = join(__dirname, '..', '..', '..', 'pocketbase', 'pb_hooks', 'ensure_superuser.pb.js');

function boot(dao: Record<string, () => unknown>) {
  let hook: (() => void) | null = null;
  const warnings: string[] = [];
  vm.runInNewContext(readFileSync(HOOK, 'utf8'), {
    onAfterBootstrap: (fn: () => void) => (hook = fn),
    $app: { dao: () => dao },
    $os: { getenv: (k: string) => ({ EMBER_PB_SUPERUSER_EMAIL: 'su@x.test', EMBER_PB_SUPERUSER_PASSWORD: 'Long-Enough-2026' })[k] ?? '' },
    $security: { sha256: () => 'not-the-old-one' },
    Admin: function Admin(this: Record<string, unknown>) {
      this.setPassword = () => {};
    },
    console: { log: () => {}, warn: (m: string) => warnings.push(m) },
  });
  hook!();
  return warnings;
}

const noTables = () => {
  throw new Error('SQL logic error: no such table: _admins (1)');
};

describe('ensure_superuser.pb.js', () => {
  it('warns instead of stopping the boot when the superuser tables do not exist yet', () => {
    let warnings: string[] = [];
    expect(() => (warnings = boot({ findAdminByEmail: noTables, saveAdmin: noTables, totalAdmins: noTables }))).not.toThrow();
    expect(warnings.some((w) => w.includes('could not count'))).toBe(true);
  });

  it('still warns about extra superusers when the count works', () => {
    const warnings = boot({
      findAdminByEmail: () => ({ validatePassword: () => true }),
      saveAdmin: () => {},
      totalAdmins: () => 2,
    });
    expect(warnings.some((w) => w.includes('2 superusers exist'))).toBe(true);
  });
});
