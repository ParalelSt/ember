import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

/** The design system's spacing scale lives in the `@theme inline` block of
 *  globals.css, and Tailwind 4 turns every `--spacing-<name>` token into a
 *  whole family of utilities named after it: `gap-<name>`, `p-<name>`,
 *  `w-<name>` and also `inline-<name>` (the logical-width family). A token
 *  whose name completes one of Tailwind's own utility names therefore
 *  silently redefines that utility. `--spacing-block` did exactly that: it
 *  generated a second `.inline-block` rule setting `inline-size: 1rem`,
 *  emitted after the core `display: inline-block` one and at the same
 *  specificity, so every `inline-block` element in the app was pinned to
 *  16px wide. The full-screen player's title, two `inline-block` copies of
 *  the song name, became two 16px boxes of overflowing text sliding over
 *  each other: the "flickering, mumbled" title that was reported.
 *
 *  This compiles Tailwind against the app's real theme block and requires
 *  that any display utility a token shadows has an explicit override in
 *  globals.css putting the stolen property back. Add a token that collides
 *  with `flex` or `grid` tomorrow and this fails until it is handled. */

const require = createRequire(import.meta.url);
const WEB_ROOT = join(__dirname, '..');

// Every display utility used in the app, plus the rest of the family so a
// future token cannot shadow one we have not reached for yet.
const DISPLAY_UTILITIES: Record<string, string> = {
  block: 'block',
  'inline-block': 'inline-block',
  inline: 'inline',
  flex: 'flex',
  'inline-flex': 'inline-flex',
  grid: 'grid',
  'inline-grid': 'inline-grid',
  contents: 'contents',
  table: 'table',
  hidden: 'none',
};

async function globalsCss(): Promise<string> {
  return readFile(join(WEB_ROOT, 'app/globals.css'), 'utf8');
}

/** globals.css without its comments, so a rule quoted in a comment (this
 *  file's own fix is explained in one) cannot pass for a real override. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Does globals.css itself declare `property` on `.<name>`? */
function overrides(css: string, name: string, property: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`, 'g');
  for (const match of stripComments(css).matchAll(rule)) {
    if (new RegExp(`(^|;)\\s*${property}\\s*:`).test(match[1])) return true;
  }
  return false;
}

/** The `@theme inline { ... }` block out of globals.css, verbatim. */
function themeBlock(css: string): string {
  const start = css.indexOf('@theme inline {');
  if (start < 0) throw new Error('no @theme inline block in globals.css');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unterminated @theme block in globals.css');
}

async function compileWithTheme(theme: string, classes: string[]): Promise<string> {
  const { compile } = await import('tailwindcss');
  const twRoot = dirname(require.resolve('tailwindcss/package.json'));
  const compiler = await compile(`@import "tailwindcss";\n${theme}\n`, {
    base: WEB_ROOT,
    loadStylesheet: async (id: string) => {
      const file = id === 'tailwindcss'
        ? join(twRoot, 'index.css')
        : resolve(twRoot, id.replace(/^tailwindcss\//, ''));
      return { path: file, base: dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  return compiler.build(classes);
}

/** Every top-level declaration Tailwind emitted for `.<name>`, flattened. */
function declarationsFor(css: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(^|\\n)\\s*\\.${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const out: string[] = [];
  for (const match of css.matchAll(rule)) {
    for (const decl of match[2].split(';')) {
      const trimmed = decl.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

/** The property names a token stole from `.<name>`, beyond `display`. */
function shadowedProperties(css: string, name: string, display: string): string[] {
  return declarationsFor(css, name)
    .filter((decl) => decl !== `display: ${display}`)
    .map((decl) => decl.slice(0, decl.indexOf(':')).trim());
}

describe('theme tokens do not shadow core utilities', () => {
  it('detects a shadow when there is one', async () => {
    // Sanity check on the detection itself, against the token in isolation.
    const css = await compileWithTheme('@theme inline {\n  --spacing-block: 1rem;\n}', ['inline-block']);
    expect(shadowedProperties(css, 'inline-block', 'inline-block')).toEqual(['inline-size']);
  });

  it('puts back every display property the app\'s own tokens steal', async () => {
    const source = await globalsCss();
    const css = await compileWithTheme(themeBlock(source), Object.keys(DISPLAY_UTILITIES));
    for (const [name, display] of Object.entries(DISPLAY_UTILITIES)) {
      expect(declarationsFor(css, name), `.${name} was not generated`).toContain(`display: ${display}`);
      for (const property of shadowedProperties(css, name, display)) {
        // globals.css has to hand the property back, or the utility means
        // something other than what its name says everywhere it is used.
        expect(
          overrides(source, name, property),
          `a --spacing-* token shadows .${name} with "${property}"; globals.css must reset it`,
        ).toBe(true);
      }
    }
  });
});
