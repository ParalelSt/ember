import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('phone search bounds', () => {
  const overlay = read('components/search/SearchOverlay.tsx');
  const layout = read('app/(app)/layout.tsx');

  it('uses the shell content height instead of covering the player with a viewport-sized portal', () => {
    expect(overlay).toContain('absolute inset-0');
    expect(overlay).toContain('h-full');
    expect(overlay).not.toContain('<Dialog');
    // The search and top bar share a bounded area that ends before PlayerBar.
    expect(layout).toMatch(/data-phone-search-area[\s\S]*<TopBar[\s\S]*<SearchOverlayContainer[\s\S]*<\/div>\s*<PlayerBar/);
  });

  it('caps results above the Android keyboard and respects the status bar', () => {
    expect(overlay).toContain('max-h-[calc(100dvh-var(--keyboard-inset,0px)-var(--safe-bottom,0px))]');
    expect(overlay).toContain('pt-(--safe-top)');
    expect(overlay).toContain('min-h-0 flex-1 overflow-y-auto');
  });
});
