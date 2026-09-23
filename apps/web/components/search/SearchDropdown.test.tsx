import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchDropdown } from './SearchDropdown';

/** Owner's report: on desktop the search pill's wrapper had no bottom
 *  padding, so a scrolled page's content ran straight up to its bottom
 *  edge. Fix: this wrapper (the box's own container, above the scroll
 *  area) carries `pb-block`, the 16px spacing token, alongside the
 *  existing `px-page-lg pt-page-lg`. The matching top-of-scroller fade
 *  lives in app/(app)/layout.tsx, covered by its own test. */
describe('SearchDropdown', () => {
  it('adds the block-token bottom gap under the pill, alongside the existing padding', () => {
    render(
      <SearchDropdown open={false} onClose={() => {}} field={<input />} body={<div />} />,
    );
    const wrap = screen.getByRole('search').parentElement!.parentElement!;
    expect(wrap.className).toContain('pb-block');
    expect(wrap.className).toContain('px-page-lg');
    expect(wrap.className).toContain('pt-page-lg');
  });
});
