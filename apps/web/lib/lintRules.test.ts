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
  'app/(app)/dizajn/sve/page.tsx': 45,
  'app/(app)/library/loading.tsx': 5,
  'app/(app)/library/page.tsx': 6,
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

// The colour ratchet (themes plan section 6). A component never names a
// colour, it names a token: `bg-ember`, `text-ember-foreground`, `bg-art`,
// `bg-foreground`. A theme swaps the tokens, so a raw `text-white` on the
// accent turns invisible the moment someone picks a white accent (Mono), and
// a raw `bg-black` behind artwork ignores the theme. A raw colour is a
// Tailwind palette utility (`text-white`, `bg-black/40`, `from-slate-500`,
// `bg-amber-500`); opacity and variant prefixes (`hover:bg-black/50`) count.
const RAW_COLOUR =
  /(?<=^|[\s"'`{(:!])(?:text|bg|border|ring|fill|stroke|from|to|via|shadow|outline|decoration|placeholder|caret|divide|accent)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?(?=$|[\s"'`})])/g;

/** app/ and components/ source (.ts and .tsx) INCLUDING shadcn's
 *  components/ui (its overlays are colours too), minus tests. */
function colourFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
    }
  };
  for (const dir of SCAN_DIRS) visit(join(ROOT, dir));
  return out;
}

const countRawColour = (text: string) => [...text.matchAll(RAW_COLOUR)].length;

// File (relative to apps/web) -> raw colour classes it may keep, because the
// colour must stay fixed whatever the theme. Generated from the tree after
// the Task 4 sweep. Same rules as SPACING_BASELINE: over fails, under fails
// until the number is lowered, unlisted files must have none. Adding a file
// here needs a reason in the same shape as the ones below.
const COLOUR_BASELINE: Record<string, number> = {
  // Scrims over photos: black veil, white text on it, in every theme. That is
  // what keeps a label readable over album art.
  'components/AttachmentPicker.tsx': 2, // bg-black/60 caption strip + text-white
  'components/page/CollectionHeader.tsx': 2, // "Change cover" hover scrim + text-white
  'components/import/parts.tsx': 3, // play/pause scrim on a candidate cover + text-white
  'components/import/ReviewSheet.tsx': 1, // sheet backdrop bg-black/20
  'components/tabs/TabSourceSheet.tsx': 1, // tap-to-close backdrop bg-black/50
  'components/ui/dialog.tsx': 1, // shadcn overlay bg-black/10
  'components/ui/sheet.tsx': 1, // shadcn overlay bg-black/10
  // Danger stays red in every theme (owner decision 5), so white on it stays.
  'components/ui/confirm-dialog.tsx': 1, // text-white on bg-destructive
  // Status colours: severity is semantic, not decorative.
  'components/BugReportDialog.tsx': 6, // SEVERITY_STYLE low/medium/high
  // /dizajn candidates (mock data on the design gallery, never in the app):
  // their scrims mirror the shipped ones above, the rest is mock chrome.
  'components/library/options/CoverLedShelf.tsx': 3, // cover scrim gradient + title
  'components/library/options/FeaturedShelf.tsx': 4, // cover scrim gradient + title, subtitle
  'components/library/options/attachments/AttachmentsSection.tsx': 2, // caption strip, as AttachmentPicker
  'components/library/options/attachments/index.ts': 8, // mock file thumbnail swatches
  'components/library/options/changelog/ShellPreview.tsx': 1, // mock dialog backdrop
  'components/library/options/imports/ImportDialog.tsx': 1, // mock dialog backdrop
  'components/library/options/imports/ReviewScreens.tsx': 1, // mock sheet backdrop
  'components/library/options/imports/parts.tsx': 3, // play scrim, as import/parts
  'components/library/options/mobileplayer/AndroidNavStrip.tsx': 4, // mock Android nav bar
  'components/library/options/phonesearch/MockKeyboard.tsx': 8, // mock OS keyboard
  'components/library/options/playlist-copy/parts.tsx': 1, // mock dialog and sheet backdrop
  'components/library/options/searchrows/SearchRowsSection.tsx': 1, // mock overlay backdrop
  'components/library/options/tabs/PasteSection.tsx': 1, // mock dialog backdrop
  'components/library/options/tabs/TabsSection.tsx': 1, // mock sheet backdrop
  'components/library/options/trending/TrendingShelves.tsx': 4, // rank-number scrim + text, play scrim + icon
};

describe('colour ratchet', () => {
  const files = colourFiles();
  const counts = new Map(files.map((f) => [relative(ROOT, f), countRawColour(readFileSync(f, 'utf8'))] as const));

  it('matches raw colour classes and nothing else', () => {
    expect(countRawColour('className="text-white bg-black/40 hover:bg-black/50 from-slate-500 bg-amber-500 ring-white/10"')).toBe(6);
    expect(countRawColour("cn('fill-white/85', on && 'border-zinc-800')")).toBe(2);
    expect(
      countRawColour(
        'className="bg-ember text-ember-foreground bg-art bg-foreground ring-foreground/10 text-muted-foreground bg-background whitespace-nowrap bg-transparent border-border"',
      ),
    ).toBe(0);
  });

  it('no file has more raw colour than its baseline (unlisted files: none)', () => {
    const over = [...counts]
      .filter(([file, n]) => n > (COLOUR_BASELINE[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} raw colour classes, baseline ${COLOUR_BASELINE[file] ?? 0} (use a token: bg-ember, text-ember-foreground, bg-art, bg-foreground)`);
    expect(over, over.join('\n')).toEqual([]);
  });

  it('no file is under its baseline (lower COLOUR_BASELINE when you remove a raw colour)', () => {
    const under = Object.entries(COLOUR_BASELINE)
      .filter(([file, allowed]) => (counts.get(file) ?? 0) < allowed)
      .map(([file, allowed]) => `${file}: baseline ${allowed}, now ${counts.get(file) ?? 0}`);
    expect(under, under.join('\n')).toEqual([]);
  });

  // Text on the accent is --ember-foreground: white on red, dark on a light
  // accent. text-white there is the Mono white-on-white play button.
  it('never puts text-white on bg-ember (use text-ember-foreground or <Button variant="ember">)', () => {
    const pattern = /bg-ember(?![-/\w])[^"'`]*text-white|text-white[^"'`]*bg-ember(?![-/\w])/;
    const hits: Hit[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
        if (pattern.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
      });
    }
    expect(hits, formatHits(hits)).toEqual([]);
  });

  // Hex, rgb() and hsl() colours: brand dots (Spotify green is Spotify
  // green), mock covers, and the example in the hex field's hint. Nothing else.
  const LITERAL_COLOUR_ALLOWED: Record<string, string> = {
    'components/import/parts.tsx': 'SOURCE_DOT brand dots',
    'components/library/options/imports/parts.tsx': 'SOURCE_DOT brand dots (/dizajn copy)',
    'app/(app)/dizajn/mock.ts': 'mock covers on the design gallery',
    'components/settings/appearance/previewData.ts': 'mock covers in the theme preview',
    'components/settings/appearance/ColourRow.tsx': 'the "#1a2b3c" example in the invalid-hex hint',
  };

  it('has no hex, rgb() or hsl() colour outside the allowed files', () => {
    const literal = /#[0-9a-fA-F]{6}\b|\b(?:rgba?|hsla?)\(/;
    const hits = files
      .filter((f) => !(relative(ROOT, f) in LITERAL_COLOUR_ALLOWED))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((text, i) => (literal.test(text) ? [{ file, line: i + 1, text: text.trim() }] : [])),
      );
    expect(hits, formatHits(hits)).toEqual([]);
  });

  it('keeps arbitrary bg-[#...] to the SOURCE_DOT brand dots', () => {
    const hits = findSubstring(files, 'bg-[#').filter(
      (h) => !['components/import/parts.tsx', 'components/library/options/imports/parts.tsx'].includes(relative(ROOT, h.file)),
    );
    expect(hits, formatHits(hits)).toEqual([]);
  });

  it('every allowed literal-colour file still has one (drop stale entries)', () => {
    const literal = /#[0-9a-fA-F]{6}\b|\b(?:rgba?|hsla?)\(/;
    const stale = Object.keys(LITERAL_COLOUR_ALLOWED).filter((f) => !literal.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(stale).toEqual([]);
  });
});

// globals.css resets `.inline-block { inline-size: auto; }` (see
// lib/themeCollisions.test.ts for why), and that rule is emitted after every
// width utility at the same specificity, so it wins: `inline-block w-5` or
// `inline-block size-4` renders 0px wide when the element is empty (the
// switch thumbs that vanished). Give a sized element `block` (a flex child
// needs nothing else) or `inline-flex` instead.
describe('inline-block with a width', () => {
  it('never pairs inline-block with a w-* or size-* class on one line', () => {
    const pattern = /(?<=^|[\s"'`{(:!])inline-block(?=$|[\s"'`})])[^\n]*?(?<=[\s"'`{(:!])(?:w|size)-[\w.[\]/%-]+|(?<=[\s"'`{(:!])(?:w|size)-[\w.[\]/%-]+[^\n]*?(?<=[\s"'`{(:!])inline-block(?=$|[\s"'`})])/;
    expect(pattern.test("'inline-block h-5 w-5 rounded-full'")).toBe(true);
    expect(pattern.test("'size-4 inline-block'")).toBe(true);
    expect(pattern.test('className="mt-6 inline-block text-xs max-w-sm"')).toBe(false);
    const hits: Hit[] = [];
    for (const file of allTsxFiles()) {
      readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
        if (pattern.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
      });
    }
    expect(hits, formatHits(hits)).toEqual([]);
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
    // PhonePlayerBar's own chrome (PLAYER_BAR_CHROME) does NOT carry the
    // class: MobileNav below it is the bottom-most element in the phone
    // shell and spends it alone, or the two would double up and leave an
    // empty band under the seek line. On a desktop-width window MobileNav
    // is `md:hidden` and contributes nothing, so PlayerBar's own footer
    // spends the class itself there instead.
    uses('components/player/PlayerBar.tsx', 'PLAYER_BAR_CHROME');
    uses('components/player/PlayerBar.tsx', 'safe-area-bottom');
    uses('components/library/options/mobileplayer/MobilePlayerSection.tsx', 'PLAYER_BAR_CHROME');
    uses('components/nav/MobileNav.tsx', 'safe-area-bottom');
    uses('components/nav/TopBar.tsx', 'var(--safe-top)');
    uses('components/player/NowPlaying.tsx', 'var(--safe-top)');
    uses('components/player/NowPlaying.tsx', 'var(--safe-bottom)');
  });
});
