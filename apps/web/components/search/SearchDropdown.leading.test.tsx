import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchDropdown } from './SearchDropdown';

describe('SearchDropdown leading slot', () => {
  it('puts the leading node left of the box, outside the search anchor', () => {
    render(
      <SearchDropdown
        open={false}
        onClose={() => {}}
        field={<input aria-label="Search box" />}
        body={null}
        leading={<button type="button">Back</button>}
      />,
    );
    const back = screen.getByRole('button', { name: 'Back' });
    const anchor = screen.getByRole('search');
    expect(back.nextElementSibling).toBe(anchor);
    expect(anchor.contains(back)).toBe(false);
    expect(anchor).toHaveClass('flex-1', 'max-w-xl', 'min-w-0');
  });

  it('without one the box is alone in its row', () => {
    render(<SearchDropdown open={false} onClose={() => {}} field={<input aria-label="Search box" />} body={null} />);
    expect(screen.getByRole('search').parentElement!.children).toHaveLength(1);
  });
});
