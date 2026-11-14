import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MyUpload } from '@/types/track';

// base-ui's Dialog and Menu as plain elements, as in the uploads page test.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
    <div role="dialog" data-testid={testId}>{children}</div>
  ),
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button type="button" {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <div role="menuitem" onClick={onClick}>{children}</div>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const state = vi.hoisted(() => ({
  user: { id: 'owner1' } as { id: string } | null,
  uploads: [] as MyUpload[],
  api: { listMyUploads: vi.fn(), updateUpload: vi.fn(), setUploadCover: vi.fn(), removeUploadCover: vi.fn(), deleteUpload: vi.fn() },
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: state.api }));
vi.mock('@/lib/uploadXhr', () => ({ uploadSongXhr: () => new Promise(() => {}) }));

const { UploadsSection } = await import('./UploadsSection');
const { resetSharedUploadQueue } = await import('@/hooks/useUploadQueue');
const { UPLOADS_SHARED_TEXT } = await import('@/components/settings/useUploadsSettings');

const up = (n: number): MyUpload => ({
  id: `upload:u${n}`, source: 'upload', sourceId: `u${n}`, title: `Song ${n}`, artist: `Artist ${n}`,
  artistId: null, album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: '',
  sizeBytes: 1024 * 1024, created: '2026-10-12 10:00:00.000Z',
});

const renderSection = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UploadsSection />
    </QueryClientProvider>,
  );
const group = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  state.user = { id: 'owner1' };
  state.uploads = [up(1), up(2)];
  state.api.listMyUploads.mockImplementation(async () => ({ uploads: state.uploads }));
  state.api.deleteUpload.mockResolvedValue({ ok: true });
});
afterEach(() => {
  resetSharedUploadQueue();
  vi.clearAllMocks();
});

describe('desktop Settings > Uploads as rows', () => {
  it('an Add music group with Upload songs, then Your uploads with a count, no cards', async () => {
    renderSection();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Add music', 'Your uploads']);
    expect(within(group('Add music')).getByText(UPLOADS_SHARED_TEXT)).toBeInTheDocument();
    const rows = await within(group('Your uploads')).findAllByTestId('my-upload-row');
    expect(rows).toHaveLength(2);
    expect(within(group('Your uploads')).getByText('2 songs')).toBeInTheDocument();
    for (const g of document.querySelectorAll('[data-settings-group]')) expect(g).not.toHaveClass('bg-card');
  });

  it('Upload songs opens and closes the drop zone', () => {
    renderSection();
    const button = within(group('Add music')).getByRole('button', { name: 'Upload songs' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('upload-drop')).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Drop songs here or browse files' })).toBeInTheDocument();
    fireEvent.click(button);
    expect(document.getElementById('upload-drop')).toBeNull();
  });

  it('with none, a row says so and Add songs opens the drop zone', async () => {
    state.uploads = [];
    renderSection();
    expect(await within(group('Your uploads')).findByText('Nothing uploaded yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add songs' }));
    expect(document.getElementById('upload-drop')).not.toBeNull();
  });

  it('Remove asks first, then deletes', async () => {
    renderSection();
    const [first] = await screen.findAllByTestId('my-upload-row');
    fireEvent.click(within(first).getByRole('menuitem', { name: /Remove/ }));
    const confirm = screen.getByRole('dialog');
    expect(confirm).toHaveTextContent('Remove "Song 1"?');
    await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' })));
    expect(state.api.deleteUpload).toHaveBeenCalledWith('u1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('signed out, says to sign in', () => {
    state.user = null;
    renderSection();
    expect(screen.getByText('Sign in to upload songs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload songs' })).toBeNull();
  });
});
