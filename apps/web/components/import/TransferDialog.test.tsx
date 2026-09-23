import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RATE_LIMITED_MESSAGE } from '@/lib/import/transferCopy';
import { MATCHED_BY_NAME, SPOTIFY_LINK_CAP } from '@/lib/import/transferRoutes';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';

// The dialog's three plain questions (where they land, where the music is
// now, what you already have), every route each answer reaches, and every
// sentence a refused upload puts on screen. The real base-ui dialog resolves
// a second React copy under happy-dom (see ReviewSheet.test.tsx), so its
// shell is stubbed.

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
  googleLikesConfig: vi.fn(),
  googleLikesBegin: vi.fn(),
  googleLikesStatus: vi.fn(),
  googleLikesStart: vi.fn(),
  googleLikesCancel: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

const { TransferDialog } = await import('./TransferDialog');
const { ALL_SERVICES, LIKED_SERVICES_OPEN } = await import('@/lib/import/transferRoutes');

const LINK = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const YT_LINK = 'https://music.youtube.com/playlist?list=PLabc123def456';

/** useIsDesktop reads a real media query, and happy-dom drives matchMedia
 *  off window.innerWidth (see hooks/useIsDesktop.test.tsx). */
interface HappyWindow extends Omit<Window, 'innerWidth'> {
  innerWidth: number;
  happyDOM?: { setViewport?: (viewport: { width: number }) => void };
}
function setWidth(px: number) {
  act(() => {
    const w = window as unknown as HappyWindow;
    w.happyDOM?.setViewport?.({ width: px });
    w.innerWidth = px;
    w.dispatchEvent(new Event('resize'));
  });
}

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
      <TransferDialog open onOpenChange={onOpenChange} likedServicesOpen={ALL_SERVICES} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

/** Question one: where the songs land. */
function pick(name: 'Liked songs' | 'A new playlist') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
}

/** Question two: where the music is now. */
function service(name: 'Spotify' | 'YouTube Music' | 'Apple Music' | 'Somewhere else') {
  const card = screen.getAllByTestId('transfer-service-card').find((c) => c.textContent === name);
  if (!card) throw new Error(`no service card called ${name}`);
  fireEvent.click(card);
}

/** Question three: what is already in hand. */
function have(match: RegExp) {
  const option = screen.getAllByTestId('transfer-have-option').find((o) => match.test(o.textContent ?? ''));
  if (!option) throw new Error(`no "what do you have" option matching ${match}`);
  fireEvent.click(option);
}

function chooseFile(name = 'exportify.csv', body = 'Track Name,Artist Name\na,b\n') {
  const input = screen.getByLabelText('Song list file');
  fireEvent.change(input, { target: { files: [new File([body], name, { type: 'text/csv' })] } });
}

/** Straight to the Spotify converter-file route, the one most of the error
 *  cases below travel through. */
function toSpotifyFile() {
  pick('Liked songs');
  service('Spotify');
  have(/A file someone gave me/);
}

/** A refusal shaped the way lib/api.ts throws one. */
function refuse(status: number, message: string) {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
}

const startButton = () => screen.getByRole('button', { name: /^Transfer/ });
const steps = () => screen.getByTestId('transfer-steps').textContent ?? '';

beforeEach(() => {
  setWidth(1280);
  push.mockReset();
  logger.breadcrumb.mockReset();
  logger.error.mockReset();
  toast.info.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.googleLikesConfig.mockResolvedValue({ configured: true });
  api.googleLikesCancel.mockResolvedValue({ cancelled: true });
});

describe('TransferDialog: where the songs land', () => {
  it('asks that first, as two cards with their consequence', () => {
    setup();
    const cards = screen.getAllByTestId('transfer-destination-card');
    expect(cards.map((c) => c.dataset.destination)).toEqual(['liked', 'playlist']);
    expect(cards[0]).toHaveTextContent('These become your likes and shape your mixes and radio.');
    expect(cards[1]).toHaveTextContent('A playlist you can edit, reorder and share.');
    // Nothing else is asked yet, and nothing can be started.
    expect(screen.queryAllByTestId('transfer-service-card')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Transfer/ })).toBeNull();
  });

  it('picking one asks where the music is now, saying where it is going', () => {
    setup();
    pick('Liked songs');
    expect(screen.getByTestId('transfer-chosen-destination')).toHaveTextContent('Going to your Liked songs');
    expect(screen.getAllByTestId('transfer-service-card').map((c) => c.textContent)).toEqual([
      'Spotify',
      'YouTube Music',
      'Apple Music',
      'Somewhere else',
    ]);
    expect(screen.queryByRole('button', { name: /^Transfer/ })).toBeNull();
  });

  it('Back returns to the two cards', () => {
    setup();
    pick('A new playlist');
    expect(screen.getByTestId('transfer-chosen-destination')).toHaveTextContent('a new playlist');
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getAllByTestId('transfer-destination-card')).toHaveLength(2);
  });
});

describe('TransferDialog: what do you have already', () => {
  it('Spotify asks about a link, a file, or nothing yet', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    expect(screen.getAllByTestId('transfer-have-option').map((o) => o.textContent)).toEqual([
      'A link to a playlist',
      'A file someone gave me, or one I downloaded',
      'Nothing yet, but I can wait a few days',
    ]);
    // No technical name anywhere in the question.
    expect(screen.queryByText(/CSV/)).toBeNull();
  });

  it('a file in hand gets the converter steps and the file picker, not the export wait', () => {
    setup();
    toSpotifyFile();
    expect(steps()).toMatch(/Exportify, Soundiiz or TuneMyMusic/);
    expect(steps()).not.toMatch(/Download your data/);
    expect(steps()).toContain(MATCHED_BY_NAME);
    expect(screen.getByLabelText('Song list file')).toBeInTheDocument();
  });

  it('nothing yet gets the data-export steps, and the same file picker', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    have(/Nothing yet/);
    expect(steps()).toMatch(/Download your data/);
    expect(steps()).toMatch(/YourLibrary\.json/);
    expect(screen.getByLabelText('Song list file')).toBeInTheDocument();
  });

  it('a link gets the playlist steps, and says plainly what a Spotify link cannot do', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    have(/A link to a playlist/);
    expect(steps()).toMatch(/cannot share your liked songs as a link/);
    expect(steps()).toContain(SPOTIFY_LINK_CAP);
    expect(screen.getByLabelText('Playlist link')).toBeInTheDocument();
  });

  it('Apple Music has one way in, so it asks nothing and shows the privacy-export steps', () => {
    setup();
    pick('Liked songs');
    service('Apple Music');
    expect(screen.queryAllByTestId('transfer-have-option')).toHaveLength(0);
    expect(steps()).toMatch(/privacy\.apple\.com/);
    expect(steps()).toMatch(/shares no links/);
    expect(screen.getByLabelText('Song list file')).toBeInTheDocument();
  });

  it('Somewhere else asks between a list to type and a file', () => {
    setup();
    pick('Liked songs');
    service('Somewhere else');
    expect(screen.getAllByTestId('transfer-have-option').map((o) => o.textContent)).toEqual([
      'Just a list I can type out',
      'A file someone gave me',
    ]);
    have(/Just a list/);
    expect(screen.getByLabelText('Your songs, one a line')).toBeInTheDocument();
  });

  it('Back walks the questions backwards, one at a time', () => {
    setup();
    toSpotifyFile();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getAllByTestId('transfer-have-option').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getAllByTestId('transfer-service-card')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getAllByTestId('transfer-destination-card')).toHaveLength(2);
  });

  it('a service with nothing to ask goes straight back to the services', () => {
    setup();
    pick('Liked songs');
    service('Apple Music');
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getAllByTestId('transfer-service-card')).toHaveLength(4);
  });
});

describe('TransferDialog: every answer reaches its route', () => {
  it('an uploaded file is read and previewed: where it came from, how many, the first songs', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 42, dropped: 2 }));
    setup();
    toSpotifyFile();
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
    toSpotifyFile();
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
    service('Spotify');
    have(/A file someone gave me/);
    chooseFile();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(api.transferStart.mock.calls[0][0]).toMatchObject({ destination: 'playlist' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/playlist/p7'));
  });

  it('a typed-out list is read once typing stops', async () => {
    api.transferPreview.mockResolvedValue(preview({ kind: 'paste', label: 'Liked songs from a list', count: 2 }));
    setup();
    pick('Liked songs');
    service('Somewhere else');
    have(/Just a list/);
    fireEvent.change(screen.getByLabelText('Your songs, one a line'), {
      target: { value: 'Halcyon Drift - Paper Lanterns\nNadia Okonkwo - Slow Weather' },
    });
    await waitFor(() => expect(api.transferPreview).toHaveBeenCalledWith({ text: expect.stringContaining('Paper Lanterns') }));
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toHaveTextContent('Liked songs from a list'));
  });

  it('a pasted Spotify playlist link is looked up and starts through the link route', async () => {
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
    service('Spotify');
    have(/A link to a playlist/);
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    await waitFor(() => expect(screen.getByTestId('link-preview')).toHaveTextContent('Late night drive'));
    fireEvent.click(startButton());
    await waitFor(() => expect(api.importStart).toHaveBeenCalledWith(LINK, 'liked'));
  });

  it('a pasted YouTube Music playlist link goes through the same route', async () => {
    api.importInspect.mockResolvedValue({
      source: 'ytmusic',
      name: 'Weekend',
      tracks: [{ artworkUrl: null }, { artworkUrl: null }],
    });
    api.importStart.mockResolvedValue({ job: { ...job, source: 'ytmusic' }, playlistId: 'p9' });
    setup();
    pick('A new playlist');
    service('YouTube Music');
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: YT_LINK } });
    await waitFor(() => expect(screen.getByTestId('link-preview')).toHaveTextContent('Weekend'));
    fireEvent.click(startButton());
    await waitFor(() => expect(api.importStart).toHaveBeenCalledWith(YT_LINK, 'playlist'));
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
      toSpotifyFile();
      chooseFile();
      await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(shown));
      expect(screen.getByTestId('transfer-error')).toHaveAttribute('role', 'alert');
      expect(startButton()).toBeDisabled();
    });
  }

  it('over 10 000 songs: the preview says to split the file and Start stays off', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 10_000, truncated: true }));
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-over-cap')).toBeInTheDocument());
    expect(screen.getByTestId('transfer-over-cap')).toHaveTextContent('Split the file and upload it in parts.');
    expect(startButton()).toBeDisabled();
  });

  it('a file with no songs in it: Start stays off', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 0, sample: [] }));
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-empty')).toBeInTheDocument());
    expect(startButton()).toBeDisabled();
  });

  it('a refusal at Start is shown the same way', async () => {
    api.transferPreview.mockResolvedValue(preview());
    api.transferStart.mockRejectedValue(refuse(429, 'Slow down, try again in about 120s.'));
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(RATE_LIMITED_MESSAGE));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('TransferDialog: YouTube Music likes, after a Google sign-in', () => {
  const FLOW = 'flow_abcdefghijklmnopqrstuv';
  const googlePreview = (over: Record<string, unknown> = {}) => ({
    kind: 'ytmusic-liked',
    label: 'Liked songs from YouTube Music',
    order: 'newest-first',
    count: 3,
    dropped: 0,
    truncated: false,
    skipped: 4,
    sample: [{ title: 'Paper Lanterns', artist: 'Halcyon Drift' }],
    ...over,
  });
  const begun = {
    flowId: FLOW,
    userCode: 'WXYZ-QRST',
    verificationUrl: 'https://www.google.com/device',
    expiresIn: 900,
    interval: 5,
  };

  function toGoogle() {
    pick('Liked songs');
    service('YouTube Music');
    have(/sign in to my Google account/);
  }
  const signInButton = () => screen.getByRole('button', { name: /Sign in with Google/ });
  /** One of the dialog's polls of the server. */
  const poll = () => act(() => vi.advanceTimersByTimeAsync(2_000));

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.googleLikesBegin.mockResolvedValue(begun);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is only offered once Liked songs is the destination', () => {
    setup();
    pick('A new playlist');
    service('YouTube Music');
    expect(screen.queryAllByTestId('transfer-have-option')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Sign in with Google/ })).toBeNull();
    expect(screen.getByLabelText('Playlist link')).toBeInTheDocument();
  });

  it('with Liked songs it is the first answer, and it needs no name matching', () => {
    setup();
    pick('Liked songs');
    service('YouTube Music');
    expect(screen.getAllByTestId('transfer-have-option').map((o) => o.textContent)).toEqual([
      'I can sign in to my Google account',
      'A link to a playlist',
    ]);
    have(/sign in to my Google account/);
    expect(steps()).toMatch(/google\.com\/device/);
    expect(steps()).toMatch(/nothing to look up by name/);
    expect(steps()).toMatch(/signs itself out/);
    expect(steps()).not.toContain(MATCHED_BY_NAME);
    expect(steps()).not.toMatch(/F12|headers/);
  });

  it('shows one button, and asks Google for nothing until it is pressed', async () => {
    setup();
    toGoogle();
    await waitFor(() => expect(api.googleLikesConfig).toHaveBeenCalled());
    expect(signInButton()).toBeEnabled();
    expect(api.googleLikesBegin).not.toHaveBeenCalled();
    // Works on a phone too: there is nothing desktop-only left.
    setWidth(390);
    expect(signInButton()).toBeInTheDocument();
  });

  it('pressing it shows the code large, a link to Google, and a waiting line', async () => {
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-user-code')).toHaveTextContent('WXYZ-QRST'));
    const link = screen.getByTestId('google-verification-link');
    expect(link).toHaveAttribute('href', 'https://www.google.com/device');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('Open google.com/device');
    expect(screen.getByTestId('google-waiting')).toHaveTextContent('Waiting for you to allow Ember');
    expect(screen.queryByRole('button', { name: /Sign in with Google/ })).toBeNull();
    // Any Google account can import, so Google's unverified-app page is
    // coming: say so before they reach it, so nobody backs out.
    expect(screen.getByTestId('google-unverified-hint')).toHaveTextContent("Google will say it hasn't verified Ember");
    expect(screen.getByTestId('google-unverified-hint')).toHaveTextContent('press Continue');
  });

  it('waiting, reading, then ready: the shared preview card, the skipped line, and Start', async () => {
    api.googleLikesStatus
      .mockResolvedValueOnce({ state: 'waiting' })
      .mockResolvedValueOnce({ state: 'reading' })
      .mockResolvedValue({ state: 'ready', preview: googlePreview() });
    api.googleLikesStart.mockResolvedValue({ job, playlistId: null, truncated: false, note: null });
    const { onOpenChange } = setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    expect(startButton()).toBeDisabled();

    await poll();
    expect(api.googleLikesStatus).toHaveBeenCalledWith(FLOW);
    expect(screen.getByTestId('google-waiting')).toHaveTextContent('Waiting for you to allow Ember');
    await poll();
    await waitFor(() => expect(screen.getByTestId('google-waiting')).toHaveTextContent('Reading your likes'));
    await poll();
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toBeInTheDocument());
    expect(screen.queryByTestId('google-code-panel')).toBeNull();
    const card = screen.getByTestId('transfer-preview');
    expect(card).toHaveTextContent('Liked songs from YouTube Music');
    expect(card).toHaveTextContent('3 songs');
    expect(card).toHaveTextContent('Paper Lanterns');
    expect(screen.getByTestId('google-skipped')).toHaveTextContent('Left out 4 likes that are not music.');

    // No more polling once it is ready.
    const calls = api.googleLikesStatus.mock.calls.length;
    await poll();
    expect(api.googleLikesStatus.mock.calls.length).toBe(calls);

    expect(startButton()).toHaveTextContent('Transfer 3 songs');
    fireEvent.click(startButton());
    await waitFor(() => expect(api.googleLikesStart).toHaveBeenCalledWith(FLOW));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/library/liked'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Started, so there is nothing left to cancel.
    expect(api.googleLikesCancel).not.toHaveBeenCalled();
  });

  it('a note on a library over the cap is toasted, not swallowed', async () => {
    api.googleLikesStatus.mockResolvedValue({ state: 'ready', preview: googlePreview({ truncated: true }) });
    api.googleLikesStart.mockResolvedValue({ job, playlistId: null, truncated: true, note: 'Ember will take the newest 10,000.' });
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    await poll();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Ember will take the newest 10,000.'));
  });

  const endings: [string, string, string][] = [
    ['denied', 'denied', GOOGLE_MESSAGES.denied],
    ['the code ran out', 'expired', GOOGLE_MESSAGES.expired],
    ['a read that failed', 'error', GOOGLE_MESSAGES.quota],
  ];
  for (const [name, state, message] of endings) {
    it(`${name}: its own sentence, and the button again`, async () => {
      api.googleLikesStatus.mockResolvedValue({ state, message });
      setup();
      toGoogle();
      fireEvent.click(signInButton());
      await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
      await poll();
      await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(message));
      expect(screen.getByTestId('transfer-error')).toHaveAttribute('role', 'alert');
      expect(signInButton()).toBeEnabled();
      expect(startButton()).toBeDisabled();
      // The server already forgot it: nothing to cancel on close.
      expect(api.googleLikesCancel).not.toHaveBeenCalled();
    });
  }

  it('a sign-in the server no longer knows says so', async () => {
    api.googleLikesStatus.mockRejectedValue(refuse(404, GOOGLE_MESSAGES.gone));
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    await poll();
    await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(GOOGLE_MESSAGES.gone));
  });

  const refusals: [string, number, string, string][] = [
    ['too many sign-ins', 429, 'Slow down, try again in about 900s.', GOOGLE_MESSAGES.rateLimited],
    ['Google unreachable', 502, GOOGLE_MESSAGES.unreachable, GOOGLE_MESSAGES.unreachable],
    ['a server setup Google refuses', 503, GOOGLE_MESSAGES.setupWrong, GOOGLE_MESSAGES.setupWrong],
    ['something unrecognised', 500, 'Request failed: 500', GOOGLE_MESSAGES.readFailed],
  ];
  for (const [name, status, serverSays, shown] of refusals) {
    it(`pressing the button when ${name}: a sentence`, async () => {
      api.googleLikesBegin.mockRejectedValue(refuse(status, serverSays));
      setup();
      toGoogle();
      fireEvent.click(signInButton());
      await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(shown));
    });
  }

  it('a server with no Google client says so up front and offers the playlist link instead', async () => {
    api.googleLikesConfig.mockResolvedValue({ configured: false });
    setup();
    toGoogle();
    await waitFor(() => expect(screen.getByTestId('google-not-set-up')).toHaveTextContent('This server is not set up for Google sign-in yet.'));
    expect(screen.queryByRole('button', { name: /Sign in with Google/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Transfer/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'A link to a playlist' }));
    expect(screen.queryByTestId('google-not-set-up')).toBeNull();
    expect(screen.getByLabelText('Playlist link')).toBeInTheDocument();
  });

  it('and says the same when the button finds out the hard way', async () => {
    api.googleLikesConfig.mockRejectedValue(new Error('offline'));
    api.googleLikesBegin.mockRejectedValue(refuse(503, GOOGLE_MESSAGES.notConfigured));
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-not-set-up')).toBeInTheDocument());
  });

  it('closing the dialog mid-sign-in cancels it, so the server revokes it now', async () => {
    const qc = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <TransferDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    rerender(
      <QueryClientProvider client={qc}>
        <TransferDialog open={false} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.googleLikesCancel).toHaveBeenCalledWith(FLOW));
    expect(api.googleLikesCancel).toHaveBeenCalledTimes(1);
    // And stops asking about it.
    const calls = api.googleLikesStatus.mock.calls.length;
    await poll();
    expect(api.googleLikesStatus.mock.calls.length).toBe(calls);
  });

  it('a code that arrives after the dialog closed is cancelled, never shown', async () => {
    let answer: (v: typeof begun) => void = () => {};
    api.googleLikesBegin.mockReturnValue(new Promise((r) => (answer = r)));
    const qc = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <TransferDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    toGoogle();
    fireEvent.click(signInButton());
    rerender(
      <QueryClientProvider client={qc}>
        <TransferDialog open={false} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    await act(async () => answer(begun));
    await waitFor(() => expect(api.googleLikesCancel).toHaveBeenCalledWith(FLOW));
    await poll();
    expect(api.googleLikesStatus).not.toHaveBeenCalled();
  });

  it('Back mid-sign-in cancels it too, and so does a ready one left unstarted', async () => {
    api.googleLikesStatus.mockResolvedValue({ state: 'ready', preview: googlePreview() });
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    await poll();
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(api.googleLikesCancel).toHaveBeenCalledWith(FLOW));
  });

  it('a second press replaces the first sign-in', async () => {
    api.googleLikesStatus.mockResolvedValue({ state: 'expired', message: GOOGLE_MESSAGES.expired });
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    await poll();
    await waitFor(() => expect(signInButton()).toBeEnabled());
    api.googleLikesBegin.mockResolvedValue({ ...begun, flowId: 'flow_second_abcdefghijklmn', userCode: 'NEWC-ODEX' });
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-user-code')).toHaveTextContent('NEWC-ODEX'));
  });

  it('a refusal at Start is a sentence and the button again', async () => {
    api.googleLikesStatus.mockResolvedValue({ state: 'ready', preview: googlePreview() });
    api.googleLikesStart.mockRejectedValue(refuse(404, GOOGLE_MESSAGES.gone));
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    await poll();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByTestId('transfer-error')).toHaveTextContent(GOOGLE_MESSAGES.gone));
    expect(signInButton()).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('TransferDialog: only YouTube Music fills the Liked songs for now', () => {
  function setupDefault() {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <TransferDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it('is the default, with YouTube Music the one service open', () => {
    expect(LIKED_SERVICES_OPEN).toEqual(['ytmusic']);
  });

  it('crosses out and disables every other service for Liked songs, and says why', () => {
    setupDefault();
    pick('Liked songs');
    const cards = screen.getAllByTestId('transfer-service-card');
    const byId = Object.fromEntries(cards.map((c) => [c.dataset.service, c as HTMLButtonElement]));
    expect(byId.ytmusic).toBeEnabled();
    for (const id of ['spotify', 'apple', 'other']) {
      expect(byId[id]).toBeDisabled();
      expect(byId[id]).toHaveClass('line-through');
    }
    expect(screen.getByTestId('transfer-services-held-back')).toHaveTextContent('For now only YouTube Music');
    // A crossed-out card does nothing when pressed.
    fireEvent.click(byId.spotify);
    expect(screen.queryAllByTestId('transfer-have-option')).toHaveLength(0);
    expect(screen.getAllByTestId('transfer-service-card')).toHaveLength(4);
  });

  it('YouTube Music still opens its choices', () => {
    setupDefault();
    pick('Liked songs');
    service('YouTube Music');
    expect(screen.getAllByTestId('transfer-have-option').length).toBeGreaterThan(0);
  });

  it('a new playlist can still come from any service', () => {
    setupDefault();
    pick('A new playlist');
    for (const card of screen.getAllByTestId('transfer-service-card')) expect(card).toBeEnabled();
    expect(screen.queryByTestId('transfer-services-held-back')).toBeNull();
  });
});
