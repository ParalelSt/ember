import type { ComponentProps, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RATE_LIMITED_MESSAGE, YTMUSIC_RATE_LIMITED_MESSAGE } from '@/lib/import/transferCopy';

// The dialog, the destination cards and every sentence a refused upload
// puts on screen. The real base-ui dialog resolves a second React copy
// under happy-dom (see ReviewSheet.test.tsx), so its shell is stubbed.

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: ComponentProps<'input'>) => <input {...props} /> }));
const logger = vi.hoisted(() => ({ breadcrumb: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger/client', () => ({ logger }));
const toast = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const api = vi.hoisted(() => ({
  transferPreview: vi.fn(),
  transferStart: vi.fn(),
  importInspect: vi.fn(),
  importStart: vi.fn(),
  ytmusicLikedPreview: vi.fn(),
  ytmusicLikedStart: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

const { TransferDialog } = await import('./TransferDialog');

const LINK = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

const preview = (over: Record<string, unknown> = {}) => ({
  preview: {
    kind: 'csv',
    label: 'Liked songs from Spotify',
    order: 'oldest-first',
    count: 3,
    dropped: 0,
    truncated: false,
    sample: [
      { title: 'Paper Lanterns', artist: 'Halcyon Drift' },
      { title: 'Nine Streets', artist: 'The Quiet Parade' },
    ],
    ...over,
  },
});

const job = { id: 'j1', source: 'csv', total: 3 };

function setup() {
  const onOpenChange = vi.fn();
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <TransferDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

/** Straight to the source step with the given destination chosen. */
function pick(name: 'Liked songs' | 'A new playlist') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
}

function chooseFile(name = 'exportify.csv', body = 'Track Name,Artist Name\na,b\n') {
  const input = screen.getByLabelText('Song list file');
  fireEvent.change(input, { target: { files: [new File([body], name, { type: 'text/csv' })] } });
}

/** A refusal shaped the way lib/api.ts throws one. */
function refuse(status: number, message: string) {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
}

const startButton = () => screen.getByRole('button', { name: /^Transfer/ });

beforeEach(() => {
  push.mockReset();
  logger.breadcrumb.mockReset();
  logger.error.mockReset();
  toast.info.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('TransferDialog: the destination step', () => {
  it('asks where the songs land first, as two cards with their consequence', () => {
    setup();
    const cards = screen.getAllByTestId('transfer-destination-card');
    expect(cards.map((c) => c.dataset.destination)).toEqual(['liked', 'playlist']);
    expect(cards[0]).toHaveTextContent('These become your likes and shape your mixes and radio.');
    expect(cards[1]).toHaveTextContent('A playlist you can edit, reorder and share.');
    // Nothing to start yet: no source has been named.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Transfer/ })).toBeNull();
  });

  it('picking one opens the source step, saying where they are going', () => {
    setup();
    pick('Liked songs');
    expect(screen.getByTestId('transfer-chosen-destination')).toHaveTextContent('Going to your Liked songs');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Upload a file',
      'Paste a list',
      'Paste a link',
      'YouTube Music',
    ]);
    expect(startButton()).toBeDisabled();
  });

  it('Back returns to the two cards', () => {
    setup();
    pick('A new playlist');
    expect(screen.getByTestId('transfer-chosen-destination')).toHaveTextContent('a new playlist');
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getAllByTestId('transfer-destination-card')).toHaveLength(2);
  });

  it('the YouTube Music tab only shows up once Liked songs is the destination', () => {
    setup();
    pick('Liked songs');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Upload a file',
      'Paste a list',
      'Paste a link',
      'YouTube Music',
    ]);
  });

  it('picking A new playlist offers no YouTube Music tab', () => {
    setup();
    pick('A new playlist');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Upload a file',
      'Paste a list',
      'Paste a link',
    ]);
  });
});

describe('TransferDialog: the source step', () => {
  it('each tab explains what that source is, before anything is chosen', () => {
    setup();
    pick('Liked songs');
    expect(screen.getByText(/YourLibrary.json inside it, unzipped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Paste a list' }));
    expect(screen.getByText(/One song a line, written "Artist - Title"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Paste a link' }));
    expect(screen.getByText(/public Spotify playlist link/)).toBeInTheDocument();
  });

  it('an uploaded file is read and previewed: where it came from, how many, the first songs', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 42, dropped: 2 }));
    setup();
    pick('Liked songs');
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toBeInTheDocument());
    const card = screen.getByTestId('transfer-preview');
    expect(card).toHaveTextContent('Liked songs from Spotify');
    expect(card).toHaveTextContent('42 songs, 2 rows Ember could not read');
    expect(card).toHaveTextContent('Paper Lanterns');
    expect(card).toHaveTextContent('and 40 more');
    expect(startButton()).toBeEnabled();
    expect(startButton()).toHaveTextContent('Transfer 42 songs');
  });

  it('starting an uploaded transfer sends the destination and lands on the Liked page', async () => {
    api.transferPreview.mockResolvedValue(preview());
    api.transferStart.mockResolvedValue({ job, playlistId: null });
    const { onOpenChange } = setup();
    pick('Liked songs');
    chooseFile();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(api.transferStart).toHaveBeenCalled());
    expect(api.transferStart.mock.calls[0][0]).toMatchObject({ destination: 'liked' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/library/liked'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('the same file can make a playlist instead, and lands on it', async () => {
    api.transferPreview.mockResolvedValue(preview());
    api.transferStart.mockResolvedValue({ job, playlistId: 'p7' });
    setup();
    pick('A new playlist');
    chooseFile();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(api.transferStart.mock.calls[0][0]).toMatchObject({ destination: 'playlist' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/playlist/p7'));
  });

  it('a pasted list is read once typing stops', async () => {
    api.transferPreview.mockResolvedValue(preview({ kind: 'paste', label: 'Liked songs from a list', count: 2 }));
    setup();
    pick('Liked songs');
    fireEvent.click(screen.getByRole('tab', { name: 'Paste a list' }));
    fireEvent.change(screen.getByLabelText('Your songs, one a line'), {
      target: { value: 'Halcyon Drift - Paper Lanterns\nNadia Okonkwo - Slow Weather' },
    });
    await waitFor(() => expect(api.transferPreview).toHaveBeenCalledWith({ text: expect.stringContaining('Paper Lanterns') }));
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toHaveTextContent('Liked songs from a list'));
  });

  it('a pasted playlist link is looked up and starts through the link route', async () => {
    api.importInspect.mockResolvedValue({
      source: 'spotify',
      id: 'x',
      name: 'Late night drive',
      coverUrl: null,
      items: [{}, {}, {}],
      truncated: false,
    });
    api.importStart.mockResolvedValue({ job: { ...job, source: 'spotify' }, playlistId: null });
    setup();
    pick('Liked songs');
    fireEvent.click(screen.getByRole('tab', { name: 'Paste a link' }));
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    await waitFor(() => expect(screen.getByTestId('link-preview')).toHaveTextContent('Late night drive'));
    fireEvent.click(startButton());
    await waitFor(() => expect(api.importStart).toHaveBeenCalledWith(LINK, 'liked'));
  });
});

describe('TransferDialog: what it says when Ember will not take it', () => {
  const cases: [string, number, string, string][] = [
    ['nothing to read', 400, 'Choose a file or paste your songs.', 'Choose a file or paste your songs.'],
    [
      'over 20 MB',
      413,
      'That file is over 20 MB. Ember reads song lists, not whole libraries of audio.',
      'That file is over 20 MB.',
    ],
    [
      'a zip',
      422,
      'That is a zip. Unzip it and upload the YourLibrary.json inside (Spotify puts it in the my_spotify_data folder).',
      'Unzip it and upload the YourLibrary.json inside',
    ],
    [
      'UTF-16',
      422,
      'Ember could not read that file: it is saved as UTF-16. Save it again as UTF-8 and upload it once more.',
      'saved as UTF-16',
    ],
    ['too many uploads', 429, 'Slow down, try again in about 900s.', RATE_LIMITED_MESSAGE],
  ];

  for (const [name, status, serverSays, shown] of cases) {
    it(`${name}: a sentence, not a code`, async () => {
      api.transferPreview.mockRejectedValue(refuse(status, serverSays));
      setup();
      pick('Liked songs');
      chooseFile();
      await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(shown));
      expect(screen.getByTestId('transfer-error')).toHaveAttribute('role', 'alert');
      expect(startButton()).toBeDisabled();
    });
  }

  it('over 10 000 songs: the preview says to split the file and Start stays off', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 10_000, truncated: true }));
    setup();
    pick('Liked songs');
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-over-cap')).toBeInTheDocument());
    expect(screen.getByTestId('transfer-over-cap')).toHaveTextContent('Split the file and upload it in parts.');
    expect(startButton()).toBeDisabled();
  });

  it('a file with no songs in it: Start stays off', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 0, sample: [] }));
    setup();
    pick('Liked songs');
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-empty')).toBeInTheDocument());
    expect(startButton()).toBeDisabled();
  });

  it('a refusal at Start is shown the same way', async () => {
    api.transferPreview.mockResolvedValue(preview());
    api.transferStart.mockRejectedValue(refuse(429, 'Slow down, try again in about 120s.'));
    setup();
    pick('Liked songs');
    chooseFile();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(RATE_LIMITED_MESSAGE));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('TransferDialog: YouTube Music likes, straight from the account', () => {
  const ytPreview = (over: Record<string, unknown> = {}) => ({
    preview: {
      kind: 'ytmusic-liked',
      label: 'Liked songs from YouTube Music',
      order: 'newest-first',
      count: 3,
      dropped: 0,
      truncated: false,
      sample: [{ title: 'Paper Lanterns', artist: 'Halcyon Drift' }],
      ...over,
    },
  });
  const SECRET = 'cookie: SAPISID=some-fake-session-value; other=1\nx-goog-authuser: 0';

  function openYtmusicTab() {
    pick('Liked songs');
    fireEvent.click(screen.getByRole('tab', { name: 'YouTube Music' }));
  }

  function pasteSecret(value = SECRET) {
    fireEvent.change(screen.getByLabelText('Your YouTube Music request headers'), { target: { value } });
  }

  const previewButton = () => screen.getByRole('button', { name: /^Preview|^Reading/ });

  it('is only offered once Liked songs is the destination, and asks nothing on its own', () => {
    setup();
    pick('A new playlist');
    expect(screen.queryByRole('tab', { name: 'YouTube Music' })).toBeNull();
    expect(api.ytmusicLikedPreview).not.toHaveBeenCalled();
  });

  it('shows the steps, the desktop-only line and the used-once note, and reads nothing until Preview is pressed', () => {
    setup();
    openYtmusicTab();
    expect(screen.getByText(/Open music\.youtube\.com|music\.youtube\.com in Chrome/)).toBeInTheDocument();
    expect(screen.getByText(/needs a desktop browser/)).toBeInTheDocument();
    expect(screen.getByText(/Signing out of YouTube Music afterwards makes them useless/)).toBeInTheDocument();
    pasteSecret();
    expect(api.ytmusicLikedPreview).not.toHaveBeenCalled();
    expect(previewButton()).toBeEnabled();
  });

  it('Preview reads the account and renders the shared preview card', async () => {
    api.ytmusicLikedPreview.mockResolvedValue(ytPreview());
    setup();
    openYtmusicTab();
    pasteSecret();
    fireEvent.click(previewButton());
    expect(api.ytmusicLikedPreview).toHaveBeenCalledWith(SECRET);
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toBeInTheDocument());
    const card = screen.getByTestId('transfer-preview');
    expect(card).toHaveTextContent('Liked songs from YouTube Music');
    expect(card).toHaveTextContent('3 songs');
    expect(card).toHaveTextContent('Paper Lanterns');
    expect(startButton()).toBeEnabled();
    expect(startButton()).toHaveTextContent('Transfer 3 songs');
  });

  it('Start queues the transfer, lands on Liked songs, and clears the pasted headers', async () => {
    api.ytmusicLikedPreview.mockResolvedValue(ytPreview());
    api.ytmusicLikedStart.mockResolvedValue({ job, playlistId: null, truncated: false, note: null });
    const { onOpenChange } = setup();
    openYtmusicTab();
    pasteSecret();
    fireEvent.click(previewButton());
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(api.ytmusicLikedStart).toHaveBeenCalledWith(SECRET));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/library/liked'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('Your YouTube Music request headers')).toHaveValue('');
  });

  it('a note on a truncated account is toasted, not swallowed', async () => {
    api.ytmusicLikedPreview.mockResolvedValue(ytPreview({ truncated: true }));
    api.ytmusicLikedStart.mockResolvedValue({
      job,
      playlistId: null,
      truncated: true,
      note: 'Ember can transfer up to 10,000 songs at once, and your YouTube Music library has more. Ember will take the newest 10,000.',
    });
    setup();
    openYtmusicTab();
    pasteSecret();
    fireEvent.click(previewButton());
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('Ember will take the newest')));
  });

  const cases: [string, number, string][] = [
    ['nothing pasted', 400, 'Paste your YouTube Music request headers first. Open music.youtube.com…'],
    ['a signed-out cookie', 400, 'That Cookie line is from a signed-out tab. Sign in to music.youtube.com and try again.'],
    ['signed out or stale headers', 401, 'Your YouTube Music session has expired. Sign in again and paste fresh headers.'],
    ['no likes on the account', 422, 'There are no liked songs in that YouTube Music account yet.'],
    ['YouTube Music unreachable', 502, 'Ember could not read your YouTube Music likes. Try again in a moment.'],
  ];
  for (const [name, status, message] of cases) {
    it(`${name}: shown as its own sentence`, async () => {
      api.ytmusicLikedPreview.mockRejectedValue(refuse(status, message));
      setup();
      openYtmusicTab();
      pasteSecret();
      fireEvent.click(previewButton());
      await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(message));
      expect(screen.getByTestId('transfer-error')).toHaveAttribute('role', 'alert');
    });
  }

  it('three tries an hour: the 429 reads like a person wrote it', async () => {
    api.ytmusicLikedPreview.mockRejectedValue(refuse(429, 'Slow down, try again in about 900s.'));
    setup();
    openYtmusicTab();
    pasteSecret();
    fireEvent.click(previewButton());
    await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(YTMUSIC_RATE_LIMITED_MESSAGE));
    expect(YTMUSIC_RATE_LIMITED_MESSAGE).toMatch(/three/i);
  });

  it('the pasted headers never reach the logger, and are cleared when the dialog closes', async () => {
    api.ytmusicLikedPreview.mockRejectedValue(refuse(401, 'Your YouTube Music session has expired.'));
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <TransferDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    pick('Liked songs');
    fireEvent.click(screen.getByRole('tab', { name: 'YouTube Music' }));
    pasteSecret();
    fireEvent.click(previewButton());
    await waitFor(() => expect(screen.getByTestId('transfer-error')).toBeInTheDocument());

    const everyLoggedString = [...logger.breadcrumb.mock.calls, ...logger.error.mock.calls]
      .flat()
      .map((v) => JSON.stringify(v))
      .join('\n');
    expect(everyLoggedString).not.toContain(SECRET);
    expect(everyLoggedString).not.toContain('some-fake-session-value');

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TransferDialog open={false} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TransferDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    pick('Liked songs');
    fireEvent.click(screen.getByRole('tab', { name: 'YouTube Music' }));
    expect(screen.getByLabelText('Your YouTube Music request headers')).toHaveValue('');
  });
});
