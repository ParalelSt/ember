import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Style lint: scans app/ and components/ for patterns the tokens and type
// utilities in globals.css (deslop step 2) replaced, so they can't creep
// back in. Two bans are unconditional substring checks (oklch(, to-[ never
// belonged in TSX; nothing legitimately contains them). The type-utility
// bans check for an EXACT className value instead of a substring: several
// call sites intentionally keep the same classes plus one more (e.g. a
// margin), which the migration brief explicitly leaves alone rather than
// splitting a class string apart, so a substring ban would misfire on
// those. Raw Tailwind spacing classes (gap-3, mb-6, py-2...) are held by a
// ratchet instead of a ban: see SPACING_BASELINE below.

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

  // The hero cover pairs the step 2 report left counted but unbanned. Step
  // 3 added --spacing-art-hero (11rem) and --spacing-art-hero-sm (9rem) so
  // every hero size is a token, and CollectionHeader owns the geometry, so
  // a raw pair coming back means a hero stopped going through it.
  for (const pair of ['h-44 w-44', 'h-48 w-48', 'md:h-44 md:w-44', 'md:h-48 md:w-48']) {
    it(`has no raw ${pair} artwork pair (use the art tokens)`, () => {
      const hits = findSubstring(files, pair);
      expect(hits, `use size-art-*:\n${formatHits(hits)}`).toHaveLength(0);
    });
  }
});

// The spacing ratchet (docs/design-system.md section 6). A raw spacing
// class is a margin, padding, gap or space-* utility with a number (or px)
// instead of a scale token: `mb-6` rather than `mb-stack`. Allowed: `-0`,
// `-auto`, and negative margins for scroll bleed (`-mx-1`, which the
// lookbehind skips because the token starts with a dash). Variant prefixes
// (`md:px-8`) still count.
const RAW_SPACING =
  /(?<=^|[\s"'`{(:!])(?:m[tbxy]?|p[tbxy]?|gap(?:-[xy])?|space-[xy])-(\d+(?:\.\d+)?|px)(?=$|[\s"'`})])/g;

/** app/ and components/ source (.ts and .tsx), minus shadcn's components/ui
 *  (its icon gaps are its own) and tests (not UI). */
function ratchetFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (relative(ROOT, full) !== join('components', 'ui')) visit(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  };
  for (const dir of SCAN_DIRS) visit(join(ROOT, dir));
  return out;
}

function countRawSpacing(file: string): number {
  let n = 0;
  for (const match of readFileSync(file, 'utf8').matchAll(RAW_SPACING)) if (match[1] !== '0') n++;
  return n;
}

// File (relative to apps/web) -> raw spacing classes it may still have.
// Generated from the tree after stage 1. A file over its number fails (new
// raw spacing crept in: use the tokens); a file UNDER its number also fails
// until the number here is lowered, so progress can't be given back later;
// a file not listed must have none. Each stage lowers this map; stage 5
// empties it.
const SPACING_BASELINE: Record<string, number> = {
  'app/(app)/admin/invites/page.tsx': 8,
  'app/(app)/admin/layout.tsx': 3,
  'app/(app)/admin/tracks/page.tsx': 14,
  'app/(app)/admin/users/page.tsx': 8,
  'app/(app)/dizajn/page.tsx': 45,
  'app/(app)/library/loading.tsx': 5,
  'app/(app)/library/page.tsx': 7,
  'app/(app)/page.tsx': 1,
  'app/(app)/playlist/[id]/page.tsx': 2,
  'app/(app)/search/loading.tsx': 8,
  'app/(app)/search/page.tsx': 6,
  'app/(app)/session/[id]/page.tsx': 22,
  'app/(app)/settings/downloads/page.tsx': 7,
  'app/(app)/settings/help/page.tsx': 12,
  'app/(app)/settings/layout.tsx': 4,
  'app/(app)/settings/plugins/page.tsx': 14,
  'app/(app)/settings/profile/page.tsx': 9,
  'app/auth/page.tsx': 18,
  'components/AppErrorBoundary.tsx': 4,
  'components/BugReportDialog.tsx': 9,
  'components/FriendsListening.tsx': 5,
  'components/OfflinePlaceholder.tsx': 3,
  'components/RequestDialog.tsx': 5,
  'components/admin/AdminTabs.tsx': 3,
  'components/artist/AlbumCard.tsx': 3,
  'components/artist/AlbumRow.tsx': 3,
  'components/changelog/ChangelogPage.tsx': 10,
  'components/changelog/HideTagsSwitch.tsx': 1,
  'components/changelog/NewBadge.tsx': 2,
  'components/changelog/WhatsNewLink.tsx': 3,
  'components/library/CollectionCard.tsx': 4,
  'components/library/CollectionShelf.tsx': 5,
  'components/library/options/CoverLedShelf.tsx': 5,
  'components/library/options/DenseListShelf.tsx': 6,
  'components/library/options/EditorialGridShelf.tsx': 7,
  'components/library/options/FeaturedShelf.tsx': 9,
  'components/library/options/changelog/ChangelogPage.tsx': 5,
  'components/library/options/changelog/ChangelogPanel.tsx': 11,
  'components/library/options/changelog/ChangelogSection.tsx': 15,
  'components/library/options/changelog/HideTagsSwitch.tsx': 1,
  'components/library/options/changelog/NewBadge.tsx': 3,
  'components/library/options/changelog/Placements.tsx': 21,
  'components/library/options/changelog/ShellPreview.tsx': 54,
  'components/nav/CollectionNavList.tsx': 5,
  'components/nav/Drawer.tsx': 18,
  'components/nav/MobileNav.tsx': 2,
  'components/nav/NavLinks.tsx': 3,
  'components/nav/PlaylistNavList.tsx': 4,
  'components/nav/Sidebar.tsx': 19,
  'components/nav/TopBar.tsx': 4,
  'components/page/CollectionSkeleton.tsx': 4,
  'components/page/EmptyState.tsx': 1,
  'components/page/PageTitle.tsx': 1,
  'components/page/SectionHeader.tsx': 1,
  'components/player/LyricsBody.tsx': 22,
  'components/player/NowPlaying.tsx': 8,
  'components/player/NowPlayingSummary.tsx': 2,
  'components/player/PlayerBar.tsx': 8,
  'components/player/QueueSheet.tsx': 11,
  'components/player/SeekBar.tsx': 2,
  'components/player/TransportControls.tsx': 2,
  'components/player/VolumeControl.tsx': 1,
  'components/search/SearchOverlay.tsx': 3,
  'components/search/SearchOverlayContainer.tsx': 2,
  'components/session/SessionDialogs.tsx': 4,
  'components/settings/PrivacyToggles.tsx': 8,
  'components/settings/SettingsTabs.tsx': 3,
  'components/track/TrackCard.tsx': 4,
  'components/track/TrackRow.tsx': 9,
  'components/track/TrackShelf.tsx': 10,
  'components/track/menus/ReplaceTrackDialog.tsx': 7,
  'components/track/menus/TrackSearchPicker.tsx': 9,
  'components/track/menus/UploadTrackDialog.tsx': 4,
};

describe('spacing ratchet', () => {
  const counts = new Map(ratchetFiles().map((f) => [relative(ROOT, f), countRawSpacing(f)] as const));

  it('matches raw spacing classes and nothing else', () => {
    const hits = (text: string) => [...text.matchAll(RAW_SPACING)].filter((m) => m[1] !== '0').length;
    expect(hits('className="mb-6 gap-3 md:px-8 py-0.5 space-y-2 gap-x-4 p-px"')).toBe(7);
    expect(hits('className="mb-stack gap-cluster p-page md:p-page-lg -mx-1 mt-0 mx-auto size-12 top-2"')).toBe(0);
    expect(hits("cn('mt-3', active && 'py-2')")).toBe(2);
  });

  it('no file has more raw spacing than its baseline (unlisted files: none)', () => {
    const over = [...counts]
      .filter(([file, n]) => n > (SPACING_BASELINE[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} raw spacing classes, baseline ${SPACING_BASELINE[file] ?? 0} (use the spacing tokens)`);
    expect(over, over.join('\n')).toEqual([]);
  });

  it('no file is under its baseline (lower SPACING_BASELINE when you remove raw spacing)', () => {
    const under = Object.entries(SPACING_BASELINE)
      .filter(([file, allowed]) => (counts.get(file) ?? 0) < allowed)
      .map(([file, allowed]) => `${file}: baseline ${allowed}, now ${counts.get(file) ?? 0}`);
    expect(under, under.join('\n')).toEqual([]);
  });

  it('the stage 1 collection stack uses tokens only', () => {
    for (const file of [
      'components/page/CollectionHeader.tsx',
      'components/page/ActionBar.tsx',
      'components/library/CollectionPage.tsx',
      'components/track/TrackPageClient.tsx',
      'app/(app)/album/[id]/page.tsx',
      'app/(app)/artist/[id]/page.tsx',
      'app/(app)/layout.tsx',
    ]) {
      expect(counts.get(file), file).toBe(0);
      expect(SPACING_BASELINE[file], file).toBeUndefined();
    }
  });
});

// The safe-area inset (Android's system navigation bar, an iPhone's home
// indicator and notch) is one value in one place: --safe-top / --safe-bottom
// on :root in globals.css, spent through two utility classes. Before this,
// three components each carried their own `env(safe-area-inset-*, 0px)`
// string, which is how one of them could be fixed and the others not.
describe('safe-area insets', () => {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  const occurrences = (needle: string) => css.split(needle).length - 1;

  it('derives both insets once, from env() and the native inset, each falling back to 0', () => {
    expect(occurrences('--safe-top: max(env(safe-area-inset-top, 0px), var(--ember-inset-top, 0px));')).toBe(1);
    expect(occurrences('--safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--ember-inset-bottom, 0px));')).toBe(1);
    // Both arms fall back to 0px, so where there is no inset at all — every
    // desktop browser, iOS Safari with nothing in the way — the bars move by
    // nothing and the layout is exactly what it was.
    expect(occurrences('env(safe-area-inset-top, 0px)')).toBe(1);
    expect(occurrences('env(safe-area-inset-bottom, 0px)')).toBe(1);
  });

  it('spends them through exactly one utility class each', () => {
    expect(occurrences('.safe-area-bottom { padding-bottom: var(--safe-bottom); }')).toBe(1);
    expect(occurrences('.safe-area-top    { padding-top: var(--safe-top); }')).toBe(1);
  });

  it('leaves no component with an env(safe-area-inset-*) string of its own', () => {
    const hits = allTsxFiles()
      .filter((f) => /style=\{\{[^}]*env\(safe-area-inset-/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('is what the bars and the nav actually use', () => {
    const uses = (file: string, token: string) =>
      expect(readFileSync(join(ROOT, file), 'utf8'), file).toContain(token);
    // The player bar spends it once, in PLAYER_BAR_CHROME, which both
    // PlayerBar's footer and the design gallery's preview render.
    uses('components/player/PhonePlayerBar.tsx', 'safe-area-bottom');
    uses('components/player/PlayerBar.tsx', 'PLAYER_BAR_CHROME');
    uses('components/library/options/mobileplayer/MobilePlayerSection.tsx', 'PLAYER_BAR_CHROME');
    uses('components/nav/MobileNav.tsx', 'safe-area-bottom');
    uses('components/nav/TopBar.tsx', 'var(--safe-top)');
    uses('components/player/NowPlaying.tsx', 'var(--safe-top)');
    uses('components/player/NowPlaying.tsx', 'var(--safe-bottom)');
  });
});
