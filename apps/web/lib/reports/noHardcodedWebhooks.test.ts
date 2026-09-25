// @vitest-environment node
// Guard against ever reintroducing a real Discord webhook URL into source. A
// hardcoded one used to live in this directory (discord.ts's
// DEFAULT_WEBHOOK_URL) and in the lyrics-report route; a public secret
// scanner found it and Discord deleted the webhook. Webhooks must come from
// the environment only (see discord.ts's doc comment) — this test fails the
// suite if a real-looking one shows up anywhere in tracked source.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/web/lib/reports -> apps/web/lib -> apps/web -> apps -> repo root.
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

// Skip known-binary extensions: git ls-files already excludes ignored paths
// (node_modules, .next, build output), but a real webhook could never live
// in an image or audio fixture anyway, so there is no reason to read them.
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'avif', 'bmp',
  'm4a', 'mp3', 'mp4', 'wav', 'woff', 'woff2', 'otf', 'ttf',
  'pdf', 'zip', 'jar',
]);

// Matches Discord's webhook URL shape. A "real-looking" id/token pair (long
// digits + a long opaque token) is flagged; the obviously-fake shapes tests
// use (id `0`, or "example" in either part) are allowed through.
const WEBHOOK_PATTERN = /discord(?:app)?\.com\/api\/webhooks\/([0-9A-Za-z_-]+)\/([0-9A-Za-z_-]+)/g;

function isObviouslyFake(id: string, token: string): boolean {
  return id === '0' || /example/i.test(id) || /example/i.test(token);
}

describe('no hardcoded Discord webhook URLs', () => {
  it('finds no real-looking discord webhook URL in tracked source', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => {
        const ext = f.split('.').pop()?.toLowerCase() ?? '';
        return !BINARY_EXT.has(ext);
      });

    const offenders: string[] = [];
    for (const relPath of files) {
      let text: string;
      try {
        text = readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      } catch {
        continue; // unreadable (e.g. a symlink to a missing target); skip
      }
      WEBHOOK_PATTERN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WEBHOOK_PATTERN.exec(text))) {
        const [full, id, token] = m;
        if (!isObviouslyFake(id, token)) offenders.push(`${relPath}: ${full}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('sanity check: the pattern itself would catch a real-looking URL', () => {
    // A fabricated but realistically-shaped id/token, not a real webhook.
    const text = 'https://discord.com/api/webhooks/9876543210987654321/aBcDeFgHiJkLmNoPqRsTuVwXyZ01234567890abcdefghijkl';
    WEBHOOK_PATTERN.lastIndex = 0;
    const m = WEBHOOK_PATTERN.exec(text);
    expect(m).not.toBeNull();
    expect(isObviouslyFake(m![1], m![2])).toBe(false);
  });

  it('sanity check: the fake shapes the guard allows are actually allowed', () => {
    expect(isObviouslyFake('0', 'anything')).toBe(true);
    expect(isObviouslyFake('example', 'anything')).toBe(true);
    expect(isObviouslyFake('123', 'example-token')).toBe(true);
  });
});
