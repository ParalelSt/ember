import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DownloadButton } from './DownloadButton';

// O7: the web/desktop download path only survives while Ember stays open in
// that tab (no service worker fronts the app shell, so a reload or an
// offline launch can't even load the page to read the saved files back).
// The idle button used to promise plain "offline playback" regardless of
// platform, which is only true for Android's native downloads.
describe('DownloadButton (idle)', () => {
  const props = {
    state: 'idle' as const,
    onDownload: vi.fn(),
    onCancel: vi.fn(),
    onRemove: vi.fn(),
    onUpdate: vi.fn(),
  };

  it('promises full offline playback on native (Android)', () => {
    render(<DownloadButton {...props} native />);
    expect(screen.getByRole('button', { name: /Download for offline/ })).toHaveAttribute(
      'title',
      'Save this collection for offline playback',
    );
  });

  it('is honest about the tab needing to stay open on web/desktop', () => {
    render(<DownloadButton {...props} />);
    const button = screen.getByRole('button', { name: /Download for offline/ });
    expect(button).toHaveAttribute('title', 'Plays offline while Ember stays open in this tab');
    expect(button.getAttribute('title')).not.toMatch(/^Save this collection/);
  });
});
