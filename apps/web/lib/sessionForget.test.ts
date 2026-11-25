// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A member's own account change through an app route (name, avatar,
// theme, privacy switches...) must forget their remembered session
// (lib/sessionCache), or a rotated cookie could carry the old copy for up
// to the cache window.
describe('self-updates of a users record forget the remembered session', () => {
  it('every route or helper that updates the caller\'s own users record calls forgetUser', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (f !== 'node_modules' && f !== '.next') walk(p);
        } else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
      }
    };
    walk(join(root, 'app/api'));
    walk(join(root, 'lib'));
    const updaters = files.filter((f) => /collection\('users'\)\s*\.update\(/.test(readFileSync(f, 'utf8')));
    expect(updaters.length).toBeGreaterThanOrEqual(7);
    for (const f of updaters) expect(readFileSync(f, 'utf8'), f).toMatch(/forgetUser\(/);
  });
});
