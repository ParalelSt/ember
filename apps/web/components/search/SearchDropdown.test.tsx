import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchDropdown } from './SearchDropdown';

/** The owner tried a 16px gap under the desktop search pill and rejected
 *  it: it pushed the page and its scrollbar down. The wrapper keeps only
 *  its original `px-page-lg pt-page-lg`; the cut-off edge is handled by
 *  the top-of-scroller fade in app/(app)/layout.tsx instead. */
describe('SearchDropdown', () => {
  it('adds no bottom gap under the pill (the fade handles the edge)', () => {
    render(
      <SearchDropdown open={false} onClose={() => {}} field={<input />} body={<div />} />,
    );
    const wrap = screen.getByRole('search').parentElement!.parentElement!;
    expect(wrap.className).not.toContain('pb-block');
    expect(wrap.className).toContain('px-page-lg');
    expect(wrap.className).toContain('pt-page-lg');
  });
});
