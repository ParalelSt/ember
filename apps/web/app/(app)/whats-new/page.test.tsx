import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => search.params,
}));

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
const { CHANGELOG_PAGE_SIZE } = await import('@/components/changelog/ChangelogPage');

const initial = useChangelogStore.getState();

beforeEach(() => {
  search.params = new URLSearchParams();
  useChangelogStore.setState({ ...initial, seenVersion: '0.0.1', hideNew: false, loaded: true }, true);
  updateChangelog.mockReset();
  updateChangelog.mockImplementation(async (patch: { seenVersion?: string; hideNew?: boolean; readIds?: string[] }) => ({
    seenVersion: patch.seenVersion ?? '0.0.1',
    hideNew: patch.hideNew ?? false,
    readIds: patch.readIds ?? [],
  }));
});

describe('What\'s new page', () => {
  it('lists the newest ten entries and tags the ones above the seen version', () => {
    expect(CHANGELOG.length).toBeGreaterThan(CHANGELOG_PAGE_SIZE);
    render(<WhatsNewPage />);
    const shown = screen.getAllByTestId('changelog-entry');
    expect(shown).toHaveLength(CHANGELOG_PAGE_SIZE);
    expect(shown.map((e) => e.getAttribute('data-entry-id'))).toEqual(CHANGELOG.slice(0, CHANGELOG_PAGE_SIZE).map((e) => e.id));
    expect(screen.getAllByTestId('new-badge')).toHaveLength(CHANGELOG_PAGE_SIZE);
    const pager = screen.getByRole('navigation', { name: "What's new pages" });
    expect(within(pager).getByRole('link', { name: /^Page 1/ })).toHaveAttribute('aria-current', 'page');
  });

  it('?page=2 shows the next ten, with their tags', () => {
    search.params = new URLSearchParams('page=2');
    render(<WhatsNewPage />);
    const shown = screen.getAllByTestId('changelog-entry');
    expect(shown.map((e) => e.getAttribute('data-entry-id'))).toEqual(
      CHANGELOG.slice(CHANGELOG_PAGE_SIZE, CHANGELOG_PAGE_SIZE * 2).map((e) => e.id),
    );
    expect(screen.getAllByTestId('new-badge')).toHaveLength(shown.length);
    expect(screen.getByRole('link', { name: /^Page 2/ })).toHaveAttribute('aria-current', 'page');
  });

  it('a page past the end shows the last one, and a broken one the first', () => {
    const last = Math.ceil(CHANGELOG.length / CHANGELOG_PAGE_SIZE);
    search.params = new URLSearchParams('page=999');
    const view = render(<WhatsNewPage />);
    expect(screen.getAllByTestId('changelog-entry').at(-1)).toHaveAttribute('data-entry-id', CHANGELOG.at(-1)!.id);
    expect(screen.getByRole('link', { name: new RegExp(`^Page ${last}`) })).toHaveAttribute('aria-current', 'page');
    view.unmount();
    search.params = new URLSearchParams('page=two');
    render(<WhatsNewPage />);
    expect(screen.getAllByTestId('changelog-entry')[0]).toHaveAttribute('data-entry-id', CHANGELOG[0].id);
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
      fireEvent.click(screen.getByRole('switch', { name: "Don't show New tags" }));
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
