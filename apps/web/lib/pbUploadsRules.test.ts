import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// bughunt L2: uploads.deleteRule must stay server-only (null), same as
// updateRule and createRule. A member deleting their own row directly
// through PB (instead of the DELETE route) skips the route's file cleanup
// and orphans the audio/cover files on disk. The real behavior was proven
// against a live PocketBase separately (too heavy to spin up here); this is
// the fast static guard against regressing the rule text itself.
const HOOKS_FILE = join(__dirname, '..', '..', '..', 'pocketbase', 'pb_hooks', 'ensure_uploads.pb.js');
const src = readFileSync(HOOKS_FILE, 'utf8');

describe('pocketbase/pb_hooks/ensure_uploads.pb.js', () => {
  it('declares deleteRule: null for a fresh install', () => {
    expect(src).toMatch(/deleteRule:\s*null/);
    expect(src).not.toMatch(/deleteRule:\s*"uploader/);
  });

  it('rewrites an existing installation\'s deleteRule to null at boot, like updateRule', () => {
    expect(src).toMatch(/existing\.deleteRule\s*=\s*null/);
  });
});
