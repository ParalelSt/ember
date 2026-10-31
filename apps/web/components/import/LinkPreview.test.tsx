import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LinkPreview } from './LinkPreview';

const base = { name: 'Late night drive', coverUrl: null, count: 48, truncated: false };

describe('LinkPreview', () => {
  it('is big and centred: large cover, name, song count and one short line', () => {
    render(<LinkPreview {...base} />);
    const preview = screen.getByTestId('link-preview');
    expect(preview.className).toContain('items-center');
    expect(preview.className).toContain('text-center');
    expect(preview.innerHTML).toContain('size-art-hero');
    expect(screen.getByText('Late night drive')).toBeInTheDocument();
    expect(screen.getByText('48 songs')).toBeInTheDocument();
    expect(screen.getByTestId('link-preview-note')).toHaveTextContent('Fills in over a few minutes');
    expect(screen.queryByTestId('first-100-note')).toBeNull();
  });

  it('keeps the 100-song note when Spotify may have cut the playlist short', () => {
    render(<LinkPreview {...base} truncated />);
    expect(screen.getByTestId('first-100-note')).toHaveTextContent('First 100 songs.');
  });
});
