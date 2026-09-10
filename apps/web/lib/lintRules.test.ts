import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Style lint: scans app/ and components/ for patterns the tokens and type
// utilities in globals.css (deslop step 2) replaced, so they can't creep
// back in. Two bans are unconditional substring checks (oklch(, to-[ never
// belonged in TSX; nothing legitimately contains them). The type-utility
// bans check for an EXACT className value instead of a substring: several
// call sites intentionally keep the same classes plus one more (e.g. a
// margin), which the migration brief explicitly leaves alone rather than
// splitting a class string apart, so a substring ban would misfire on
// those. See the step 2 report for the h-44/h-48 pairs and the gap-*/p-*
// steps this test does NOT ban yet, and why.

const ROOT = join(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];

interface Hit {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function allTsxFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files);
  return files;
}

/** Every line containing `needle` as a plain substring. */
function findSubstring(files: string[], needle: string): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (text.includes(needle)) hits.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

/** Every `className="..."` (or '...') whose value is EXACTLY `literal`,
 *  ignoring sites that combine it with other classes (see file header). */
function findExactClassName(files: string[], literal: string): Hit[] {
  const hits: Hit[] = [];
  const pattern = /className=(["'])([^"']*)\1/g;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text))) {
        if (match[2] === literal) hits.push({ file, line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

function formatHits(hits: Hit[]): string {
  return hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n');
}

describe('style lint', () => {
  const files = allTsxFiles();

  it('has no raw oklch( in TSX (use the ember/cover-* tokens)', () => {
    const hits = findSubstring(files, 'oklch(');
    expect(hits, `raw oklch(:\n${formatHits(hits)}`).toHaveLength(0);
  });

  it('has no arbitrary gradient stop (to-[...]) left in JSX', () => {
    const hits = findSubstring(files, 'to-[');
    expect(hits, `arbitrary to-[ stop:\n${formatHits(hits)}`).toHaveLength(0);
  });

  it('has no leftover exact text-page-title class string', () => {
    const hits = findExactClassName(files, 'text-3xl md:text-4xl font-bold tracking-tight');
    expect(hits, `use text-page-title:\n${formatHits(hits)}`).toHaveLength(0);
  });

  it('has no leftover exact text-section-title class string', () => {
    const hits = findExactClassName(files, 'text-xl font-bold tracking-tight');
    expect(hits, `use text-section-title:\n${formatHits(hits)}`).toHaveLength(0);
  });

  it('has no leftover exact text-eyebrow class string', () => {
    const hits = findExactClassName(files, 'text-xs uppercase tracking-widest text-muted-foreground');
    expect(hits, `use text-eyebrow:\n${formatHits(hits)}`).toHaveLength(0);
  });

  // Not enforced yet: h-44 w-44 / h-48 w-48 (plain and md:) raw pairs still
  // appear at 4 sites (album, artist, CollectionHeader, TrackPageClient).
  // None of them equal an --spacing-art-* token exactly (h-44 is 11rem;
  // the tokens are 10rem/12rem/14rem), so swapping them now would change
  // rendered size and break this step's no-visual-change rule. Adopting
  // Artwork (DESLOP.md step 3) is where these get normalized onto the art
  // tokens; see the step 2 report for exact counts and sites.
});
