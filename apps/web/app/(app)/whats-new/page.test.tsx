import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

// The real page, hook and store; only the network is faked.
const updateChangelog = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    getChangelog: vi.fn(),
    updateChangelog: (patch: unknown) => updateChangelog(patch),
  },
}));

const { default: WhatsNewPage } = await import('./page');
const { default: WhatsNewEntryPage } = await import('./[id]/page');
const { useChangelogStore } = await import('@/stores/useChangelogStore');
const { APP_VERSION, CHANGELOG } = await import('@/lib/changelog');

const initial = useChangelogStore.getState();

beforeEach(() => {
  useChangelogStore.setState({ ...initial, seenVersion: '0.0.1', hideNew: false, loaded: true }, true);
  updateChangelog.mockReset();
  updateChangelog.mockImplementation(async (patch: { seenVersion?: string; hideNew?: boolean; readIds?: string[] }) => ({
    seenVersion: patch.seenVersion ?? '0.0.1',
    hideNew: patch.hideNew ?? false,
    readIds: patch.readIds ?? [],
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
    expect(updateChangelog).toHaveBeenCalledWith({ seenVersion: APP_VERSION, readIds: [] });
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

  it('the list only links to entries and never marks one read', () => {
    render(<WhatsNewPage />);
    const first = screen.getAllByTestId('changelog-entry')[0];
    expect(first).toHaveAttribute('href', `/whats-new/${CHANGELOG[0].id}`);
    fireEvent.click(first);
    expect(updateChangelog).not.toHaveBeenCalled();
  });
});

describe('What\'s new entry page', () => {
  it('opening an entry marks it read and persists it', async () => {
    await act(async () => {
      render(<WhatsNewEntryPage params={Promise.resolve({ id: CHANGELOG[0].id })} />);
    });
    expect(screen.getByRole('heading', { level: 1, name: CHANGELOG[0].title })).toBeInTheDocument();
    expect(updateChangelog).toHaveBeenCalledWith({ readIds: [CHANGELOG[0].id] });
    expect(useChangelogStore.getState().readIds).toContain(CHANGELOG[0].id);
    expect(useChangelogStore.getState().seenVersion).toBe('0.0.1');
  });

  it('an unknown id shows the empty state and marks nothing', async () => {
    await act(async () => {
      render(<WhatsNewEntryPage params={Promise.resolve({ id: 'nope' })} />);
    });
    expect(screen.getByTestId('changelog-missing')).toBeInTheDocument();
    expect(updateChangelog).not.toHaveBeenCalled();
  });
});
