import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

// Regression (0.7.30): the shared dialog started capping every dialog at
// 100dvh minus 2rem so small pop-ups stand off the keyboard. The phone search
// is a full-screen dialog, so it stopped 32px short of the bottom and the
// dimmed nav showed through the gap, like space kept for controls that never
// came.
describe('phone search sheet is full height', () => {
  const overlay = read('components/search/SearchOverlay.tsx');
  const dialog = read('components/ui/dialog.tsx');
  const sheetClass = overlay.match(/className="(top-0 left-0[^"]*)"/)?.[1] ?? '';
  const dialogBase = dialog.match(/"(fixed top-\[calc[^"]*)"/)?.[1] ?? '';

  it('finds both class lists', () => {
    expect(sheetClass).not.toBe('');
    expect(dialogBase).toContain('max-h-[calc(100dvh-2rem');
  });

  it('overrides the dialog height cap with an important max-h-none', () => {
    // tailwind-merge does not see max-h-none and the arbitrary calc() cap as
    // the same utility, so both would ship and CSS order would decide.
    // The important flag makes the full height win regardless.
    expect(cn(dialogBase, sheetClass).split(' ')).toContain('max-h-none!');
  });

  it('fills the screen above the keyboard', () => {
    expect(sheetClass).toContain('h-[calc(100dvh-var(--keyboard-inset,0px))]');
  });
});
