import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Small choice pop-ups must use the shared centered Dialog, not a bottom
 *  Sheet. The unit-test mocks drop all positioning, so this guards the
 *  source: the Dialog stays centered on both axes, and these call sites
 *  stay on it. Long lists (queue, devices, picker) remain bottom sheets. */
const root = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('centered pop-ups', () => {
  it('the shared Dialog centers itself with fixed + translate on both axes', () => {
    const src = read('components/ui/dialog.tsx');
    expect(src).toContain('fixed top-[calc((100dvh-var(--keyboard-inset,0px))/2)] left-1/2');
    expect(src).toContain('-translate-x-1/2 -translate-y-1/2');
  });

  it.each(['components/session/CarlistSheet.tsx', 'components/auth/ApproveSheet.tsx'])(
    '%s is a centered Dialog, not a bottom Sheet',
    (rel) => {
      const src = read(rel);
      expect(src).toContain('@/components/ui/dialog');
      expect(src).not.toContain('@/components/ui/sheet');
      expect(src).not.toContain('side="bottom"');
    },
  );

  it('the Liked-songs warning is a Dialog on phone too', () => {
    const src = read('components/track/menus/CopySongsBar.tsx');
    const warn = src.slice(src.indexOf('<Dialog open={confirmLiked}'), src.indexOf('/** The phone destination picker'));
    expect(warn).toContain('<DialogContent');
    expect(warn).not.toContain('BottomSheet');
    expect(src.match(/<BottomSheet /g)).toHaveLength(1);
  });
});
