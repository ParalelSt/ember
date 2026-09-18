import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// The real page, hook and store; only the network is faked.
const updateChangelog = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    getChangelog: vi.fn(),
    updateChangelog: (patch: unknown) => updateChangelog(patch),
  },
}));

const { default: WhatsNewPage } = await import('./page');
const { useChangelogStore } = await import('@/stores/useChangelogStore');
const { APP_VERSION, CHANGELOG } = await import('@/lib/changelog');

const initial = useChangelogStore.getState();

beforeEach(() => {
  useChangelogStore.setState({ ...initial, seenVersion: '0.0.1', hideNew: false, loaded: true }, true);
  updateChangelog.mockReset();
  updateChangelog.mockImplementation(async (patch: { seenVersion?: string; hideNew?: boolean }) => ({
    seenVersion: patch.seenVersion ?? '0.0.1',
    hideNew: patch.hideNew ?? false,
  }));
});

describe('What\'s new page', () => {
  it('lists every entry and tags the ones above the seen version', () => {
    render(<WhatsNewPage />);
    expect(screen.getAllByTestId('changelog-entry')).toHaveLength(CHANGELOG.length);
    expect(screen.getAllByTestId('new-badge')).toHaveLength(CHANGELOG.length);
  });

  it('opening the page does not mark anything read', () => {
    render(<WhatsNewPage />);
    expect(updateChangelog).not.toHaveBeenCalled();
    expect(useChangelogStore.getState().seenVersion).toBe('0.0.1');
  });

  it('Mark all as read saves the current version and clears the tags', async () => {
    render(<WhatsNewPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));
    });
    expect(updateChangelog).toHaveBeenCalledWith({ seenVersion: APP_VERSION });
    expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeDisabled();
  });

  it('the switch hides the tags and saves only hideNew', async () => {
    render(<WhatsNewPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: "Don't show New tags" }));
    });
    expect(updateChangelog).toHaveBeenCalledTimes(1);
    expect(updateChangelog).toHaveBeenCalledWith({ hideNew: true });
    expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
    expect(useChangelogStore.getState().seenVersion).toBe('0.0.1');
  });

  it('shows no tags for a user who has seen the current version', () => {
    useChangelogStore.setState({ seenVersion: APP_VERSION });
    render(<WhatsNewPage />);
    expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
  });
});
