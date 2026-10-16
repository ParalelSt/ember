import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MyUpload } from '@/types/track';

// Render base-ui's Dialog, Sheet and Menu as plain elements, so this test is
// about the page's own wiring (as in admin/tracks/page.test.tsx).
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
    <div role="dialog" data-testid={testId} data-kind="centered">{children}</div>
  ),
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, side, 'data-testid': testId }: { children: ReactNode; side?: string; 'data-testid'?: string }) => (
    <div role="dialog" data-testid={testId} data-kind={`sheet-${side}`}>{children}</div>
  ),
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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
  desktop: false,
  uploads: [] as MyUpload[],
  sends: [] as { file: File; onProgress: (n: number) => void; resolve: (v: unknown) => void; reject: (e: Error) => void }[],
  api: {
    listMyUploads: vi.fn(),
    updateUpload: vi.fn(),
    setUploadCover: vi.fn(),
    removeUploadCover: vi.fn(),
    deleteUpload: vi.fn(),
  },
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'owner1' } }) }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: state.api }));
vi.mock('@/lib/uploadXhr', () => ({
  uploadSongXhr: (file: File, p: { onProgress: (n: number) => void }) =>
    new Promise((resolve, reject) => state.sends.push({ file, onProgress: p.onProgress, resolve, reject })),
}));

const { default: UploadsPage } = await import('./page');
const { resetSharedUploadQueue } = await import('@/hooks/useUploadQueue');

const MB = 1024 * 1024;
const up = (n: number, extra: Partial<MyUpload> = {}): MyUpload => ({
  id: `upload:u${n}`, source: 'upload', sourceId: `u${n}`, title: `Song ${n}`, artist: `Artist ${n}`,
  artistId: null, album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: '',
  sizeBytes: 8.4 * MB, created: '2026-10-12 10:00:00.000Z', ...extra,
});
const song = (name: string, mb: number) => {
  const f = new File(['x'], name, { type: 'audio/mpeg' });
  Object.defineProperty(f, 'size', { value: mb * MB });
  return f;
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UploadsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.desktop = false;
  state.uploads = [up(1, { artworkUrl: '/api/uploads/u1/art' }), up(2, { album: 'Demos' })];
  state.sends = [];
  state.api.listMyUploads.mockImplementation(async () => ({ uploads: state.uploads }));
  state.api.updateUpload.mockImplementation(async (id: string, patch: object) => ({ upload: { ...up(1), ...patch } }));
  state.api.setUploadCover.mockResolvedValue({ upload: up(1) });
  state.api.removeUploadCover.mockResolvedValue({ upload: up(1) });
  state.api.deleteUpload.mockResolvedValue({ ok: true });
});
afterEach(() => {
  resetSharedUploadQueue();
  vi.clearAllMocks();
});

describe('Settings > Uploads layout', () => {
  it('puts the header, then the Upload songs bar, then Your uploads', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Uploads' })).toBeInTheDocument();
    expect(screen.getByText(/shared with everyone on this server/)).toBeInTheDocument();
    const bar = screen.getByRole('button', { name: 'Upload songs' });
    const library = screen.getByRole('heading', { name: 'Your uploads' });
    expect(bar.compareDocumentPosition(library) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findAllByTestId('my-upload-row')).toHaveLength(2);
    expect(screen.getByText('2 songs')).toBeInTheDocument();
  });

  it('the Upload songs bar toggles the compact drop zone', () => {
    renderPage();
    const bar = screen.getByRole('button', { name: 'Upload songs' });
    expect(screen.queryByTestId('upload-drop-zone')).toBeNull();
    fireEvent.click(bar);
    expect(bar).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('upload-drop-zone')).toHaveTextContent('Tap to choose songs');
    fireEvent.click(bar);
    expect(screen.queryByTestId('upload-drop-zone')).toBeNull();
  });

  it('on a desktop the zone takes dropped songs', () => {
    state.desktop = true;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Upload songs' }));
    const zone = screen.getByTestId('upload-drop-zone');
    expect(zone).toHaveTextContent('Drop songs here');
    fireEvent.drop(zone, { dataTransfer: { files: [song('a.mp3', 2), song('b.mp3', 2)] } });
    expect(state.sends.map((s) => s.file.name)).toEqual(['a.mp3', 'b.mp3']);
    // Dropping closes the zone; progress shows instead.
    expect(screen.queryByTestId('upload-drop-zone')).toBeNull();
    expect(screen.getByTestId('upload-progress')).toBeInTheDocument();
  });

  it('the file picker takes several songs and the same audio types as before', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Upload songs' }));
    const input = screen.getByLabelText('Choose songs') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('audio/*');
    expect(input.accept).toContain('.flac');
    fireEvent.change(input, { target: { files: [song('a.mp3', 1), song('b.mp3', 1), song('c.mp3', 1)] } });
    // Two at once: the third waits.
    expect(state.sends).toHaveLength(2);
  });
});

describe('the combined progress card', () => {
  const add = (files: File[]) => {
    fireEvent.click(screen.getByRole('button', { name: 'Upload songs' }));
    fireEvent.change(screen.getByLabelText('Choose songs'), { target: { files } });
  };

  it('is hidden with nothing going up', () => {
    renderPage();
    expect(screen.queryByTestId('upload-progress')).toBeNull();
  });

  it('shows songs done of all, the overall percent and megabytes sent', async () => {
    renderPage();
    add([song('a.mp3', 10), song('b.mp3', 10), song('c.mp3', 20)]);
    const card = screen.getByTestId('upload-progress');
    expect(within(card).getByTestId('upload-headline')).toHaveTextContent('Uploading 0 of 3 songs');
    act(() => {
      state.sends[0].onProgress(10 * MB);
      state.sends[1].onProgress(4 * MB);
    });
    expect(within(card).getByTestId('upload-percent')).toHaveTextContent('35%');
    expect(within(card).getByTestId('upload-bytes')).toHaveTextContent('14.0 MB of 40.0 MB');
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35');
    expect(within(card).getByRole('button', { name: 'Cancel all' })).toBeInTheDocument();

    await act(async () => state.sends[0].resolve({ id: 'upload:new' }));
    expect(within(card).getByTestId('upload-headline')).toHaveTextContent('Uploading 1 of 3 songs');
  });

  it('a failure shows a count with Retry and the server\'s message; Retry sends it again', async () => {
    renderPage();
    add([song('a.mp3', 1)]);
    await act(async () => state.sends[0].reject(new Error('Slow down, try again in about 300s.')));
    expect(screen.getByTestId('upload-failed')).toHaveTextContent('1 failed');
    expect(screen.getByTestId('upload-errors')).toHaveTextContent('a.mp3: Slow down, try again in about 300s.');
    // Nothing left going: the card offers Clear instead of Cancel all.
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.sends).toHaveLength(2);
    expect(screen.queryByTestId('upload-failed')).toBeNull();
    await act(async () => state.sends[1].resolve({ id: 'upload:a' }));
    expect(screen.getByTestId('upload-headline')).toHaveTextContent('Song uploaded');
    expect(screen.getByTestId('upload-percent')).toHaveTextContent('100%');
  });

  it('a song over 50 MB fails at once without being sent', () => {
    renderPage();
    add([song('huge.wav', 51)]);
    expect(state.sends).toHaveLength(0);
    expect(screen.getByTestId('upload-errors')).toHaveTextContent('Too large: the limit is 50 MB');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('Cancel all empties the card; Clear does once everything is done', async () => {
    renderPage();
    add([song('a.mp3', 1), song('b.mp3', 1)]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all' }));
    expect(screen.queryByTestId('upload-progress')).toBeNull();

    add([song('c.mp3', 1)]);
    await act(async () => state.sends[2].resolve({ id: 'upload:c' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByTestId('upload-progress')).toBeNull();
  });

  it('a finished song refreshes Your uploads', async () => {
    renderPage();
    await screen.findAllByTestId('my-upload-row');
    add([song('new.mp3', 1)]);
    state.uploads = [up(3), ...state.uploads];
    await act(async () => state.sends[0].resolve({ id: 'upload:u3' }));
    await waitFor(() => expect(screen.getAllByTestId('my-upload-row')).toHaveLength(3));
  });
});

describe('Your uploads rows', () => {
  it('show cover, title and "artist · size · date"', async () => {
    renderPage();
    const [first, second] = await screen.findAllByTestId('my-upload-row');
    expect(first).toHaveTextContent('Song 1');
    expect(first).toHaveTextContent('Artist 1 · 8.4 MB · 12 Oct');
    expect(first.querySelector('img')).toHaveAttribute('src', '/api/uploads/u1/art');
    expect(second.querySelector('img')).toBeNull();
  });

  it('list only your own uploads, from the my-uploads endpoint', async () => {
    renderPage();
    await screen.findAllByTestId('my-upload-row');
    expect(state.api.listMyUploads).toHaveBeenCalled();
  });

  it('say so when you have none', async () => {
    state.uploads = [];
    renderPage();
    expect(await screen.findByText(/Nothing uploaded yet/)).toBeInTheDocument();
  });

  it('the ... menu has Edit details and Remove; Remove asks first, then deletes', async () => {
    renderPage();
    const [first] = await screen.findAllByTestId('my-upload-row');
    expect(within(first).getByRole('button', { name: 'More options for Song 1' })).toBeInTheDocument();
    expect(within(first).getByRole('menuitem', { name: /Edit details/ })).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('menuitem', { name: /Remove/ }));
    const confirm = screen.getByRole('dialog');
    expect(confirm).toHaveTextContent('Remove "Song 1"?');
    expect(state.api.deleteUpload).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state.api.deleteUpload).not.toHaveBeenCalled();

    fireEvent.click(within(first).getByRole('menuitem', { name: /Remove/ }));
    await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' })));
    expect(state.api.deleteUpload).toHaveBeenCalledWith('u1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the edit sheet', () => {
  const openEdit = async (index = 0) => {
    const rows = await screen.findAllByTestId('my-upload-row');
    fireEvent.click(within(rows[index]).getByRole('menuitem', { name: /Edit details/ }));
    return screen.getByTestId('edit-upload');
  };

  it('is a bottom sheet on a phone and a centered window on a desktop', async () => {
    const { unmount } = renderPage();
    expect(await openEdit()).toHaveAttribute('data-kind', 'sheet-bottom');
    unmount();
    state.desktop = true;
    renderPage();
    expect(await openEdit()).toHaveAttribute('data-kind', 'centered');
  });

  it('shows the cover, title, artist, album and that the file cannot change', async () => {
    renderPage();
    const sheet = await openEdit(1);
    expect(within(sheet).getByRole('button', { name: /Upload cover/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Remove cover' })).toBeDisabled();
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Song 2');
    expect(within(sheet).getByLabelText('Artist')).toHaveValue('Artist 2');
    expect(within(sheet).getByLabelText('Album')).toHaveValue('Demos');
    expect(sheet).toHaveTextContent('8.4 MB · added 12 Oct · the file itself cannot change');
  });

  it('Save sends only what changed, and closes', async () => {
    renderPage();
    const sheet = await openEdit();
    fireEvent.change(within(sheet).getByLabelText('Title'), { target: { value: 'Song 1 (live) ' } });
    fireEvent.change(within(sheet).getByLabelText('Album'), { target: { value: 'Live' } });
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Save' })));
    expect(state.api.updateUpload).toHaveBeenCalledWith('u1', { title: 'Song 1 (live)', album: 'Live' });
    expect(state.api.setUploadCover).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('edit-upload')).toBeNull());
  });

  it('a picked cover goes up on Save; Remove cover removes it', async () => {
    renderPage();
    let sheet = await openEdit();
    const img = new File(['x'], 'c.png', { type: 'image/png' });
    fireEvent.change(within(sheet).getByLabelText('Choose a cover image'), { target: { files: [img] } });
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Save' })));
    expect(state.api.setUploadCover).toHaveBeenCalledWith('u1', img);
    expect(state.api.updateUpload).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('edit-upload')).toBeNull());

    sheet = await openEdit();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove cover' }));
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Save' })));
    expect(state.api.removeUploadCover).toHaveBeenCalledWith('u1');
  });

  it('turns away a cover that is not a JPEG or PNG, and an empty title', async () => {
    const { toast } = await import('sonner');
    renderPage();
    const sheet = await openEdit();
    fireEvent.change(within(sheet).getByLabelText('Choose a cover image'), {
      target: { files: [new File(['x'], 'c.gif', { type: 'image/gif' })] },
    });
    expect(toast.error).toHaveBeenCalledWith('A cover must be a JPEG or PNG image');
    fireEvent.change(within(sheet).getByLabelText('Title'), { target: { value: '  ' } });
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Save' })));
    expect(toast.error).toHaveBeenCalledWith('A song needs a title');
    expect(state.api.updateUpload).not.toHaveBeenCalled();
    expect(state.api.setUploadCover).not.toHaveBeenCalled();
  });

  it('Cancel closes without saving', async () => {
    renderPage();
    const sheet = await openEdit();
    fireEvent.change(within(sheet).getByLabelText('Title'), { target: { value: 'Nope' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('edit-upload')).toBeNull();
    expect(state.api.updateUpload).not.toHaveBeenCalled();
  });
});
