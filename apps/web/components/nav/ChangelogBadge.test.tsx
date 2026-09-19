import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// The sidebar, drawer and phone top bar wired to the real changelog store and
// hook; only their unrelated data sources are stubbed.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'dev@ember.test' }, name: 'Dev', avatarUrl: null, isAdmin: false }),
}));
vi.mock('@/hooks/useLibrary', () => ({ useQueryPlaylists: () => ({ data: [] }) }));
vi.mock('@/hooks/useCreatePlaylistFlow', () => ({
  useCreatePlaylistFlow: () => ({ createOpen: false, setCreateOpen: () => {}, handleCreate: () => {} }),
}));
vi.mock('@/components/track/menus/CreatePlaylistDialog', () => ({ CreatePlaylistDialog: () => null }));
vi.mock('@/hooks/useImports', () => ({ useImportJobs: () => ({ data: [] }) }));
// base-ui's dialog resolves a second React copy under happy-dom; the drawer's
// Sheet is not what this test is about, so render its parts as plain divs.
vi.mock('@/components/ui/sheet', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Sheet: Pass, SheetContent: Pass, SheetHeader: Pass, SheetTitle: Pass };
});
vi.mock('@/lib/api', () => ({ api: { getChangelog: vi.fn(), updateChangelog: vi.fn() } }));

const { Sidebar } = await import('./Sidebar');
const { Drawer } = await import('./Drawer');
const { TopBar } = await import('./TopBar');
const { useChangelogStore } = await import('@/stores/useChangelogStore');
const { APP_VERSION } = await import('@/lib/changelog');

const initial = useChangelogStore.getState();

function setState(seenVersion: string | null, hideNew = false) {
  useChangelogStore.setState({ ...initial, seenVersion, hideNew, loaded: seenVersion !== null }, true);
}

const whatsNewRow = () => screen.getByRole('link', { name: /what's new/i });

beforeEach(() => setState(null));

describe('Sidebar What\'s new row', () => {
  it('is there with no tag before the state loads', () => {
    render(<Sidebar />);
    expect(whatsNewRow()).toHaveAttribute('href', '/whats-new');
    expect(within(whatsNewRow()).queryByTestId('new-badge')).toBeNull();
  });

  it('shows the pulsing New tag when an entry is newer than the seen version', () => {
    setState('0.0.1');
    render(<Sidebar />);
    expect(within(whatsNewRow()).getByTestId('new-badge')).toHaveTextContent('New');
  });

  it('has no tag once the current version is seen', () => {
    setState(APP_VERSION);
    render(<Sidebar />);
    expect(within(whatsNewRow()).queryByTestId('new-badge')).toBeNull();
  });

  it('has no tag while New tags are hidden', () => {
    setState('0.0.1', true);
    render(<Sidebar />);
    expect(within(whatsNewRow()).queryByTestId('new-badge')).toBeNull();
  });
});

describe('Drawer What\'s new row', () => {
  it('shows the tag when something is New', () => {
    setState('0.0.1');
    render(<Drawer open onOpenChange={() => {}} />);
    expect(within(whatsNewRow()).getByTestId('new-badge')).toBeInTheDocument();
  });

  it('has no tag when everything is read', () => {
    setState(APP_VERSION);
    render(<Drawer open onOpenChange={() => {}} />);
    expect(within(whatsNewRow()).queryByTestId('new-badge')).toBeNull();
  });
});

describe('TopBar menu dot', () => {
  it('shows the dot on the menu button only when asked', () => {
    const { rerender } = render(<TopBar onMenu={() => {}} menuDot />);
    expect(within(screen.getByRole('button', { name: 'Open menu' })).getByTestId('unread-dot')).toBeInTheDocument();
    rerender(<TopBar onMenu={() => {}} menuDot={false} />);
    expect(screen.queryByTestId('unread-dot')).toBeNull();
  });

  it('defaults to no dot', () => {
    render(<TopBar onMenu={() => {}} />);
    expect(screen.queryByTestId('unread-dot')).toBeNull();
  });
});
