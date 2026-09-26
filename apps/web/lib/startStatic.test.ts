import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The host's launcher starts PocketBase without automigrate. With it on, the
// boot hooks' collection changes were written out as migration files, and two
// in the same second shared a name and crashed PocketBase on start.
describe('start-static.sh', () => {
  it('starts PocketBase with --automigrate=0', () => {
    const script = readFileSync(join(__dirname, '../../../start-static.sh'), 'utf8');
    const serve = script.split('\n').filter((l) => /\$PB"? serve\b/.test(l));
    expect(serve.length).toBeGreaterThan(0);
    for (const line of serve) expect(line).toContain('--automigrate=0');
  });
});
