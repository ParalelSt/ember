import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
import { ChartTile } from './ChartTile';

describe('ChartTile', () => {
  it('links to the chart, paints its colour and shows the name and Top 50', () => {
    render(<ChartTile title="Rock" href="/chart/rock" color="#b3261e" ink="#ffffff" artworkUrls={['a', 'b', 'c']} count={50} />);
    const link = screen.getByRole('link', { name: 'Rock chart' });
    expect(link.getAttribute('href')).toBe('/chart/rock');
    const box = link.firstElementChild as HTMLElement;
    expect(box.style.backgroundColor).toBeTruthy();
    expect(link.textContent).toContain('Rock');
    expect(link.textContent).toContain('Top 50');
    // Two tilted covers, never more.
    expect(link.querySelectorAll('img')).toHaveLength(2);
  });

  it('says Top N when the chart lost songs, and draws no covers without art', () => {
    render(<ChartTile title="Jazz" href="/chart/jazz" color="#2d5a3d" ink="#ffffff" artworkUrls={[]} count={47} />);
    const link = screen.getByRole('link', { name: 'Jazz chart' });
    expect(link.textContent).toContain('Top 47');
    expect(link.querySelectorAll('img')).toHaveLength(0);
  });
});
