import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/ui/dialog', () => import('@/test-utils/dialogMock'));
vi.mock('@/components/import/LinkPreview', () => ({
  LinkPreview: ({ name, count }: { name: string; count: number }) => <div data-testid="link-preview">{`${name}: ${count}`}</div>,
}));
const api = vi.hoisted(() => ({ importInspect: vi.fn(), importStart: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const { ImportLinkForm } = await import('./ImportLinkForm');

const A = 'https://open.spotify.com/playlist/AAAAAAAAAAAAAAAAAAAAAA';
const B = 'https://open.spotify.com/playlist/BBBBBBBBBBBBBBBBBBBBBB';

function renderForm() {
  const client = new QueryClient();
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ImportLinkForm onCancel={vi.fn()} onCreated={vi.fn()} />, { wrapper: wrap });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.importInspect.mockImplementation(async (link: string) => ({
    source: 'spotify',
    name: link === A ? 'Playlist A' : 'Playlist B',
    coverUrl: null,
    items: [{}, {}],
    truncated: false,
  }));
  api.importStart.mockResolvedValue({ playlistId: 'p1', job: { source: 'spotify', total: 2 } });
});

describe('ImportLinkForm', () => {
  it('Create never imports a link other than the one in the box', async () => {
    renderForm();
    const box = screen.getByLabelText('Playlist link');
    fireEvent.change(box, { target: { value: A } });
    await waitFor(() => expect(screen.getByTestId('link-preview')).toHaveTextContent('Playlist A'));

    // Another link pasted over it: until it has been looked up, A's preview
    // and its Create are gone.
    fireEvent.change(box, { target: { value: B } });
    expect(screen.queryByText('Playlist A: 2')).toBeNull();
    expect(screen.getByRole('button', { name: /^Create/ })).toBeDisabled();

    await waitFor(() => expect(screen.getByTestId('link-preview')).toHaveTextContent('Playlist B'));
    fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
    await waitFor(() => expect(api.importStart).toHaveBeenCalledWith(B));
  });

  it('a link edited into something unreadable takes the old preview away', async () => {
    renderForm();
    const box = screen.getByLabelText('Playlist link');
    fireEvent.change(box, { target: { value: A } });
    await waitFor(() => expect(screen.getByTestId('link-preview')).toBeInTheDocument());

    fireEvent.change(box, { target: { value: 'not a link' } });
    expect(screen.queryByTestId('link-preview')).toBeNull();
    expect(screen.getByRole('button', { name: /^Create/ })).toBeDisabled();
  });
});
