import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RATE_LIMITED_MESSAGE } from '@/lib/import/transferCopy';
import { MATCHED_BY_NAME, SPOTIFY_LINK_CAP } from '@/lib/import/transferRoutes';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';

// The Transfer page, a wizard: where the songs are now first, then a sheet
// asking where they go, then what you already have, the steps, every route
// each answer reaches, and every sentence a refused upload puts on screen.
// Back and the next move live in a bar at the bottom.

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: ComponentProps<'input'>) => <input {...props} /> }));
vi.mock('@/components/ui/sheet', () => import('@/test-utils/dialogMock'));
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

const { TransferFlow, safeFrom } = await import('./TransferFlow');
const { useTransferStore } = await import('@/stores/useTransferStore');
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

function setup(props: Partial<ComponentProps<typeof TransferFlow>> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TransferFlow likedServicesOpen={ALL_SERVICES} {...props} />
    </QueryClientProvider>,
  );
}

/** Where the songs land, answered in the sheet the next service opens. */
let nextDest: 'liked' | 'playlist' | null = null;
function pick(name: 'Liked songs' | 'A new playlist') {
  nextDest = name === 'Liked songs' ? 'liked' : 'playlist';
}

const sheet = () => screen.getByTestId('transfer-where-sheet');
const serviceRow = (name: string) => {
  const card = screen
    .getAllByTestId('transfer-service-card')
    .find((c) => within(c).getByTestId('transfer-service-name').textContent === name);
  if (!card) throw new Error(`no service card called ${name}`);
  return card;
};
const destRow = (d: 'liked' | 'playlist') => {
  const row = within(sheet())
    .getAllByTestId('transfer-destination-card')
    .find((c) => c.dataset.destination === d);
  if (!row) throw new Error(`no ${d} row in the sheet`);
  return row;
};

/** Where the music is now: a tap opens the sheet, which takes the
 *  destination picked with pick() (or the one already on) and Continue. */
function service(name: 'Spotify' | 'YouTube Music' | 'Apple Music' | 'Somewhere else') {
  fireEvent.click(serviceRow(name));
  if (nextDest) fireEvent.click(destRow(nextDest));
  nextDest = null;
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Continue' }));
}

/** What is already in hand: pick the row, then Next in the bar. */
function have(match: RegExp) {
  const option = screen.getAllByTestId('transfer-have-option').find((o) => match.test(o.textContent ?? ''));
  if (!option) throw new Error(`no "what do you have" option matching ${match}`);
  fireEvent.click(option);
  fireEvent.click(nextButton());
}
const nextButton = () => screen.getByRole('button', { name: 'Next' });
const backButton = () => screen.getByRole('button', { name: 'Back' });
const progressAt = () => screen.getByTestId('transfer-progress').dataset.at;

function chooseFile(name = 'exportify.csv', body = 'Track Name,Artist Name\na,b\n') {
  const input = screen.getByLabelText('Song list file');
  fireEvent.change(input, { target: { files: [new File([body], name, { type: 'text/csv' })] } });
}

/** The labels of the "what do you have already?" rows. */
const haveLabels = () => screen.getAllByTestId('transfer-have-label').map((o) => o.textContent);

/** Past the pictures to the last step, where the real control is. */
function toEnd() {
  const skip = screen.queryByRole('button', { name: 'I have it already, skip to the end' });
  if (skip) fireEvent.click(skip);
}

/** Straight to the Spotify converter-file route, the one most of the error
 *  cases below travel through. */
function toSpotifyFile() {
  pick('Liked songs');
  service('Spotify');
  have(/A file someone gave me/);
  toEnd();
}

/** A refusal shaped the way lib/api.ts throws one. */
function refuse(status: number, message: string) {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
}

const startButton = () => screen.getByRole('button', { name: /^Transfer/ });
const noStart = () => expect(screen.queryByRole('button', { name: /^Transfer/ })).toBeNull();
const continueButton = () => screen.getByRole('button', { name: 'Continue' });
/** Tap a count chip and read the songs it shows. */
function chip(id: string) {
  const c = screen.getAllByTestId('transfer-chip').find((x) => x.dataset.chip === id);
  if (!c) throw new Error(`no ${id} chip`);
  return c;
}
const steps = () => screen.getByTestId('transfer-steps').textContent ?? '';

beforeEach(() => {
  nextDest = null;
  setWidth(1280);
  push.mockReset();
  logger.breadcrumb.mockReset();
  logger.error.mockReset();
  toast.info.mockReset();
  toast.success.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.googleLikesConfig.mockResolvedValue({ configured: true });
  api.googleLikesCancel.mockResolvedValue({ cancelled: true });
});

describe('TransferFlow: services first, then a sheet for where to', () => {
  it('asks where the songs are now: the four services as rows, each saying what it needs', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Transfer songs into Ember' })).toBeInTheDocument();
    expect(screen.getByText('Where are your songs now?')).toBeInTheDocument();
    const rows = screen.getAllByTestId('transfer-service-card');
    expect(rows.map((c) => within(c).getByTestId('transfer-service-name').textContent)).toEqual([
      'Spotify',
      'YouTube Music',
      'Apple Music',
      'Somewhere else',
    ]);
    expect(rows[0]).toHaveTextContent('Your data export, a CSV or a playlist link');
    expect(rows[1]).toHaveTextContent('Sign in with Google, or a playlist link');
    expect(rows[2]).toHaveTextContent('The file Apple sends you');
    expect(rows[3]).toHaveTextContent('Paste a list, or any CSV');
    // Where they go is not asked yet, and nothing can be started.
    expect(screen.queryByTestId('transfer-where-sheet')).toBeNull();
    expect(screen.queryAllByTestId('transfer-destination-card')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Transfer/ })).toBeNull();
  });

  it('a wizard header says where you are: 1 Where, 2 How, 3 Check', () => {
    setup();
    const steps = within(screen.getByTestId('transfer-progress')).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['1 Where', '2 How', '3 Check']);
    expect(steps.map((s) => s.dataset.state)).toEqual(['current', 'next', 'next']);
    expect(progressAt()).toBe('0');
    service('Spotify');
    expect(progressAt()).toBe('1');
    const after = within(screen.getByTestId('transfer-progress')).getAllByRole('listitem');
    expect(after.map((s) => s.dataset.state)).toEqual(['done', 'current', 'next']);
  });

  it('tapping a service opens a sheet asking where they go, Liked songs picked to start with', () => {
    setup();
    fireEvent.click(serviceRow('Spotify'));
    expect(sheet()).toHaveTextContent('Where should they go?');
    expect(sheet()).toHaveTextContent('Bringing in from Spotify');
    expect(destRow('liked')).toHaveTextContent('These become your likes and shape your mixes and radio.');
    expect(destRow('playlist')).toHaveTextContent('A playlist you can edit, reorder and share.');
    expect(destRow('liked')).toHaveAttribute('aria-checked', 'true');
    expect(destRow('playlist')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(destRow('playlist'));
    expect(destRow('playlist')).toHaveAttribute('aria-checked', 'true');
    expect(destRow('liked')).toHaveAttribute('aria-checked', 'false');
    // The service row shows as picked behind the sheet.
    expect(serviceRow('Spotify')).toHaveAttribute('aria-checked', 'true');
  });

  it('Continue in the sheet goes on to what you have, for the destination picked there', () => {
    setup();
    fireEvent.click(serviceRow('Spotify'));
    fireEvent.click(destRow('playlist'));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Continue' }));
    expect(screen.queryByTestId('transfer-where-sheet')).toBeNull();
    expect(screen.getByRole('heading', { name: 'What do you have already?' })).toBeInTheDocument();
    // A new playlist: the link is the first answer.
    expect(screen.getAllByTestId('transfer-have-option')[0].dataset.route).toBe('spotify-link');
  });

  it('can open with the new playlist already picked in the sheet', () => {
    setup({ initialDestination: 'playlist' });
    fireEvent.click(serviceRow('Apple Music'));
    expect(destRow('playlist')).toHaveAttribute('aria-checked', 'true');
  });

  it('a service that cannot fill the likes opens the sheet on a new playlist, Liked songs off', () => {
    setup({ likedServicesOpen: ['ytmusic'] });
    fireEvent.click(serviceRow('Spotify'));
    expect(destRow('liked')).toBeDisabled();
    expect(destRow('playlist')).toHaveAttribute('aria-checked', 'true');
  });

  it('Next stays off until a service is picked, and reopens the sheet for it', () => {
    setup();
    expect(nextButton()).toBeDisabled();
    service('Apple Music');
    // Back from the steps keeps the service picked, so Next can carry on.
    fireEvent.click(backButton());
    expect(screen.queryByTestId('transfer-where-sheet')).toBeNull();
    expect(serviceRow('Apple Music')).toHaveAttribute('aria-checked', 'true');
    expect(nextButton()).toBeEnabled();
    fireEvent.click(nextButton());
    expect(sheet()).toHaveTextContent('Bringing in from Apple Music');
  });

  it('Back on the first screen returns to the page it was opened from', () => {
    setup({ from: '/settings/library' });
    fireEvent.click(backButton());
    expect(push).toHaveBeenCalledWith('/settings/library');
  });

  it('only follows an app path back, never another site', () => {
    expect(safeFrom('/settings/library')).toBe('/settings/library');
    expect(safeFrom('https://evil.example')).toBe('/library/liked');
    expect(safeFrom('//evil.example')).toBe('/library/liked');
    expect(safeFrom(undefined)).toBe('/library/liked');
  });
});

describe('TransferFlow: what do you have already', () => {
  it('Spotify asks about an export first, then a file, then a link, for Liked songs', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    expect(haveLabels()).toEqual([
      'Nothing yet, but I can wait a few days',
      'A file someone gave me, or one I downloaded',
      'A link to a playlist',
    ]);
    // No technical name anywhere in the question.
    expect(screen.queryByText(/CSV/)).toBeNull();
  });

  it('a file in hand gets the converter steps and the file picker, not the export wait', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    have(/A file someone gave me/);
    expect(steps()).toMatch(/Exportify, Soundiiz or TuneMyMusic/);
    expect(steps()).not.toMatch(/Download your data/);
    expect(steps()).toContain(MATCHED_BY_NAME);
    toEnd();
    expect(screen.getByLabelText('Song list file')).toBeInTheDocument();
  });

  it('nothing yet gets the data-export steps one at a time, each with a picture, then the same file picker', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    have(/Nothing yet/);
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(screen.getByTestId('transfer-step-text')).toHaveTextContent('go to Account, then Privacy settings');
    expect(screen.getByTestId('transfer-illustration')).toHaveTextContent('Account');
    expect(screen.getByTestId('transfer-illustration').querySelector('[data-tap="true"]')).toHaveTextContent('Privacy settings');
    // No file picker until the last step; Back and Next step are in the bar.
    expect(screen.queryByLabelText('Song list file')).toBeNull();
    expect(screen.getByTestId('transfer-bar')).toContainElement(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    expect(steps()).toMatch(/Download your data/);
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(steps()).toMatch(/YourLibrary\.json/);
    expect(screen.getByTestId('transfer-illustration').querySelector('[data-tap="true"]')).toHaveTextContent('YourLibrary.json');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    // The dots jump straight to a step.
    fireEvent.click(screen.getByRole('button', { name: 'Step 4' }));
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Song list file')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
    // With nothing to press, the bar says what moves it on.
    expect(screen.getByTestId('transfer-bar-hint')).toHaveTextContent('Choose the file above to go on');
  });

  it('each answer says how long that way takes', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    const rows = screen.getAllByTestId('transfer-have-option');
    expect(rows[0]).toHaveTextContent('Free and complete. Spotify takes a few days');
    expect(rows[2]).toHaveTextContent('Instant, first 100 songs only');
  });

  it('"I have it already" goes straight to the last step', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    have(/Nothing yet/);
    toEnd();
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
    expect(screen.getByTestId('transfer-illustration')).toHaveTextContent('Ember');
    expect(screen.getByLabelText('Song list file')).toBeInTheDocument();
  });

  it('a link gets the playlist steps, and says plainly what a Spotify link cannot do', () => {
    setup();
    pick('Liked songs');
    service('Spotify');
    have(/A link to a playlist/);
    expect(steps()).toMatch(/cannot share your liked songs as a link/);
    expect(steps()).toContain(SPOTIFY_LINK_CAP);
    toEnd();
    expect(screen.getByLabelText('Playlist link')).toBeInTheDocument();
  });

  it('Apple Music has one way in, so it asks nothing and shows the privacy-export steps', () => {
    setup();
    pick('Liked songs');
    service('Apple Music');
    expect(screen.queryAllByTestId('transfer-have-option')).toHaveLength(0);
    expect(steps()).toMatch(/privacy\.apple\.com/);
    expect(steps()).toMatch(/shares no links/);
    toEnd();
    expect(screen.getByLabelText('Song list file')).toBeInTheDocument();
  });

  it('Somewhere else asks between a list to type and a file', () => {
    setup();
    pick('Liked songs');
    service('Somewhere else');
    expect(haveLabels()).toEqual([
      'Just a list I can type out',
      'A file someone gave me',
    ]);
    have(/Just a list/);
    toEnd();
    expect(screen.getByLabelText('Your songs, one a line')).toBeInTheDocument();
  });

  it('Back walks the steps, then the questions, backwards one at a time', () => {
    setup();
    toSpotifyFile();
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    fireEvent.click(backButton());
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    fireEvent.click(backButton());
    expect(screen.getAllByTestId('transfer-have-option').length).toBeGreaterThan(1);
    // The answer you came back from is still picked, so Next goes on again.
    const picked = screen.getAllByTestId('transfer-have-option').find((o) => o.dataset.route === 'spotify-converter');
    expect(picked).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(backButton());
    expect(screen.getAllByTestId('transfer-service-card')).toHaveLength(4);
    fireEvent.click(backButton());
    expect(push).toHaveBeenCalledWith('/library/liked');
  });

  it('Next on what you have stays off until a row is picked', () => {
    setup();
    service('Spotify');
    expect(nextButton()).toBeDisabled();
    fireEvent.click(screen.getAllByTestId('transfer-have-option')[1]);
    expect(screen.getAllByTestId('transfer-have-option')[1]).toHaveAttribute('aria-checked', 'true');
    expect(nextButton()).toBeEnabled();
  });

  it('a service with nothing to ask goes straight back to the services', () => {
    setup();
    pick('Liked songs');
    service('Apple Music');
    fireEvent.click(backButton());
    expect(screen.getAllByTestId('transfer-service-card')).toHaveLength(4);
  });
});

describe('TransferFlow: every answer reaches its route', () => {
  it('an uploaded file is read and previewed on its own screen: where it came from, how many, the first songs', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 42, dropped: 2, unreadable: 2 }));
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Before you start' })).toBeInTheDocument();
    const card = screen.getByTestId('transfer-preview');
    expect(card).toHaveTextContent('Liked songs from Spotify');
    expect(card).toHaveTextContent('exportify.csv');
    expect(screen.getByRole('heading', { name: 'Before you start' })).toBeInTheDocument();
    expect(progressAt()).toBe('2');
    // The count as one big number, where they go and about how long under it.
    expect(screen.getByTestId('transfer-preview-count')).toHaveTextContent('42');
    expect(screen.getByTestId('transfer-preview-sentence')).toHaveTextContent('songs to bring into your Liked songs');
    expect(screen.getByTestId('transfer-preview-time')).toHaveTextContent('Under 5 minutes, you can leave while it runs');
    fireEvent.click(chip('new'));
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('Paper Lanterns');
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('and 40 more');
    expect(startButton()).toBeEnabled();
    expect(startButton()).toHaveTextContent('Transfer 42 songs');
  });

  it('starting an uploaded transfer sends the destination, follows it and goes back where you were', async () => {
    api.transferPreview.mockResolvedValue(preview());
    api.transferStart.mockResolvedValue({ job, playlistId: null });
    useTransferStore.setState({ followed: [] });
    setup({ from: '/settings/library' });
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(api.transferStart).toHaveBeenCalled());
    expect(api.transferStart.mock.calls[0][0]).toMatchObject({ destination: 'liked' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/settings/library'));
    // From the top: the pill and the bottom bar hold the bottom of the screen.
    expect(toast.success).toHaveBeenCalledWith('Transfer started. Ember tells you when it is done.', { position: 'top-center' });
    // The progress chip follows it from now on.
    expect(useTransferStore.getState().followed).toContain('j1');
  });

  it('the same file can make a playlist instead, and you still stay where you were', async () => {
    api.transferPreview.mockResolvedValue(preview());
    api.transferStart.mockResolvedValue({ job, playlistId: 'p7' });
    setup();
    pick('A new playlist');
    service('Spotify');
    have(/A file someone gave me/);
    toEnd();
    chooseFile();
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    await waitFor(() => expect(api.transferStart.mock.calls[0][0]).toMatchObject({ destination: 'playlist' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/library/liked'));
    expect(useTransferStore.getState().followed).toContain('j1');
  });

  it('a typed-out list is read when Continue is pressed', async () => {
    api.transferPreview.mockResolvedValue(preview({ kind: 'paste', label: 'Liked songs from a list', count: 2 }));
    setup();
    pick('Liked songs');
    service('Somewhere else');
    have(/Just a list/);
    toEnd();
    expect(continueButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your songs, one a line'), {
      target: { value: 'Halcyon Drift - Paper Lanterns\nNadia Okonkwo - Slow Weather' },
    });
    expect(api.transferPreview).not.toHaveBeenCalled();
    fireEvent.click(continueButton());
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
    toEnd();
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toHaveTextContent('Late night drive'));
    expect(api.importInspect).toHaveBeenCalledWith(LINK, { liked: true });
    fireEvent.click(startButton());
    await waitFor(() => expect(api.importStart).toHaveBeenCalledWith(LINK, 'liked', {}));
  });

  it('Back from the preview returns to the link box empty, and a new link is read afresh', async () => {
    api.importInspect.mockResolvedValue({
      source: 'spotify', id: 'x', name: 'Late night drive', coverUrl: null, items: [{}, {}, {}], truncated: false,
    });
    setup();
    pick('Liked songs');
    service('Spotify');
    have(/A link to a playlist/);
    toEnd();
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toHaveTextContent('Late night drive'));
    fireEvent.click(backButton());
    expect(screen.queryByTestId('transfer-preview')).toBeNull();
    expect(screen.getByLabelText('Playlist link')).toHaveValue('');
    expect(continueButton()).toBeDisabled();
    noStart();
  });

  it('Continue stays off while the list box is empty', () => {
    setup();
    pick('Liked songs');
    service('Somewhere else');
    have(/Just a list/);
    toEnd();
    const box = screen.getByLabelText('Your songs, one a line');
    fireEvent.change(box, { target: { value: 'Halcyon Drift - Paper Lanterns' } });
    expect(continueButton()).toBeEnabled();
    fireEvent.change(box, { target: { value: '   ' } });
    expect(continueButton()).toBeDisabled();
    noStart();
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
    toEnd();
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: YT_LINK } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toHaveTextContent('Weekend'));
    // A new playlist never asks about likes.
    expect(api.importInspect).toHaveBeenCalledWith(YT_LINK, { liked: false });
    expect(screen.queryByTestId('transfer-skip-liked')).toBeNull();
    fireEvent.click(startButton());
    await waitFor(() => expect(api.importStart).toHaveBeenCalledWith(YT_LINK, 'playlist', {}));
  });
});

describe('TransferFlow: what it says when Ember will not take it', () => {
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
      noStart();
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

  it('over 10 000 songs in a YourLibrary.json: Ember keeps the first 10 000 and Start stays on', async () => {
    api.transferPreview.mockResolvedValue(preview({ kind: 'spotify-export', count: 10_000, truncated: true }));
    setup();
    toSpotifyFile();
    chooseFile('YourLibrary.json', '{"tracks":[]}');
    await waitFor(() => expect(screen.getByTestId('transfer-kept-first')).toBeInTheDocument());
    expect(screen.getByTestId('transfer-kept-first')).toHaveTextContent('first 10,000');
    expect(screen.queryByTestId('transfer-over-cap')).toBeNull();
    expect(startButton()).toBeEnabled();
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

describe('TransferFlow: YouTube Music likes, after a Google sign-in', () => {
  const FLOW = 'flow_abcdefghijklmnopqrstuv';
  const googlePreview = (over: Record<string, unknown> = {}) => ({
    kind: 'ytmusic-liked',
    label: 'Liked songs from YouTube Music',
    order: 'newest-first',
    count: 3,
    dropped: 0,
    truncated: false,
    toCheck: 2,
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
    toEnd();
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
    toEnd();
    expect(screen.getByLabelText('Playlist link')).toBeInTheDocument();
  });

  it('with Liked songs it is the first answer, and it needs no name matching', () => {
    setup();
    pick('Liked songs');
    service('YouTube Music');
    expect(haveLabels()).toEqual([
      'I can sign in to my Google account',
      'A link to a playlist',
    ]);
    have(/sign in to my Google account/);
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
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

  it('waiting, reading, checking which likes are songs, then ready: songs in the card, uploads to check, and Start', async () => {
    api.googleLikesStatus
      .mockResolvedValueOnce({ state: 'waiting' })
      .mockResolvedValueOnce({ state: 'reading' })
      .mockResolvedValueOnce({ state: 'reading', checking: { done: 40, total: 120 } })
      .mockResolvedValue({ state: 'ready', preview: googlePreview() });
    api.googleLikesStart.mockResolvedValue({ job, playlistId: null, truncated: false, note: null });
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    noStart();

    await poll();
    expect(api.googleLikesStatus).toHaveBeenCalledWith(FLOW);
    expect(screen.getByTestId('google-waiting')).toHaveTextContent('Waiting for you to allow Ember');
    await poll();
    await waitFor(() => expect(screen.getByTestId('google-waiting')).toHaveTextContent('Reading your likes'));
    await poll();
    await waitFor(() => expect(screen.getByTestId('google-waiting')).toHaveTextContent('Checking which likes are songs: 40 of 120'));
    await poll();
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toBeInTheDocument());
    expect(screen.queryByTestId('google-code-panel')).toBeNull();
    const card = screen.getByTestId('transfer-preview');
    expect(card).toHaveTextContent('Liked songs from YouTube Music');
    // Songs only: what YouTube Music said is not music is nowhere.
    expect(chip('new')).toHaveTextContent('3 songs');
    expect(chip('check')).toHaveTextContent('2 to check');
    fireEvent.click(chip('new'));
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('Paper Lanterns');
    // Nothing is looked up by name, so it is quick, and there is nothing to skip.
    expect(screen.getByTestId('transfer-preview-count')).toHaveTextContent('5');
    expect(screen.getByTestId('transfer-preview-time')).toHaveTextContent('About a minute');
    expect(screen.queryByTestId('transfer-skip-liked')).toBeNull();
    expect(screen.getByTestId('google-to-check')).toHaveTextContent('2 more need a quick check: uploads YouTube Music is not sure are songs.');

    // No more polling once it is ready.
    const calls = api.googleLikesStatus.mock.calls.length;
    await poll();
    expect(api.googleLikesStatus.mock.calls.length).toBe(calls);

    // The songs and the uploads to check both come across.
    expect(startButton()).toHaveTextContent('Transfer 5 songs');
    fireEvent.click(startButton());
    await waitFor(() => expect(api.googleLikesStart).toHaveBeenCalledWith(FLOW));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/library/liked'));
    // Started, so there is nothing left to cancel.
    expect(api.googleLikesCancel).not.toHaveBeenCalled();
  });

  it('no quick-check line when YouTube Music called every like a song', async () => {
    api.googleLikesStatus.mockResolvedValue({ state: 'ready', preview: googlePreview({ count: 1, toCheck: 0 }) });
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    await poll();
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toHaveTextContent('1 song'));
    expect(screen.queryByTestId('google-to-check')).toBeNull();
    expect(startButton()).toHaveTextContent(/^Transfer 1 song$/);
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
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Ember will take the newest 10,000.', { position: 'top-center' }));
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
      noStart();
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
    toEnd();
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

  it('leaving the page mid-sign-in cancels it, so the server revokes it now', async () => {
    const { unmount } = setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    unmount();
    await waitFor(() => expect(api.googleLikesCancel).toHaveBeenCalledWith(FLOW));
    expect(api.googleLikesCancel).toHaveBeenCalledTimes(1);
    // And stops asking about it.
    const calls = api.googleLikesStatus.mock.calls.length;
    await poll();
    expect(api.googleLikesStatus.mock.calls.length).toBe(calls);
  });

  it('a code that arrives after the page was left is cancelled, never shown', async () => {
    let answer: (v: typeof begun) => void = () => {};
    api.googleLikesBegin.mockReturnValue(new Promise((r) => (answer = r)));
    const { unmount } = setup();
    toGoogle();
    fireEvent.click(signInButton());
    unmount();
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
    fireEvent.click(backButton());
    await waitFor(() => expect(api.googleLikesCancel).toHaveBeenCalledWith(FLOW));
  });

  it('Back a step from the sign-in cancels a sign-in in flight', async () => {
    api.googleLikesStatus.mockResolvedValue({ state: 'waiting' });
    setup();
    toGoogle();
    fireEvent.click(signInButton());
    await waitFor(() => expect(screen.getByTestId('google-code-panel')).toBeInTheDocument());
    const last = Number(screen.getByTestId('transfer-steps').dataset.step);
    fireEvent.click(backButton());
    await waitFor(() => expect(api.googleLikesCancel).toHaveBeenCalledWith(FLOW));
    expect(screen.queryByTestId('google-code-panel')).toBeNull();
    expect(Number(screen.getByTestId('transfer-steps').dataset.step)).toBe(last - 1);
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

describe('TransferFlow: before you start, the chips', () => {
  it('one big number says how many, with where they go and about how long under it', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 1300 }));
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-preview-count')).toHaveTextContent('1,300'));
    expect(screen.getByTestId('transfer-preview-sentence')).toHaveTextContent('songs to bring into your Liked songs');
    expect(screen.getByTestId('transfer-preview-time')).toHaveTextContent('About 30 minutes, you can leave while it runs');
    // How the songs are found, under the chips.
    expect(screen.getByTestId('transfer-preview')).toHaveTextContent(MATCHED_BY_NAME);
    // Start is in the bottom bar, beside Back.
    expect(screen.getByTestId('transfer-bar')).toContainElement(startButton());
  });

  it('one song is a song', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 1 }));
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-preview-sentence')).toHaveTextContent('song to bring into your Liked songs'));
    expect(screen.getByTestId('transfer-preview-sentence').textContent).toMatch(/^song to/);
    expect(startButton()).toHaveTextContent('Transfer 1 song');
  });

  it('every count is a chip that shows which songs it means', async () => {
    api.transferPreview.mockResolvedValue(
      preview({
        count: 120,
        dropped: 5,
        alreadyLiked: 20,
        likedSample: [{ title: 'Copper Sky', artist: 'Coastline' }],
        newSample: [{ title: 'Northbound', artist: 'Mira Vale' }],
        duplicates: 3,
        duplicateSample: [{ title: 'Paper Lanterns', artist: 'Halcyon Drift' }],
        unreadable: 2,
      }),
    );
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toBeInTheDocument());
    expect(screen.getAllByTestId('transfer-chip').map((c) => c.textContent)).toEqual([
      '100 new',
      '20 already liked',
      '3 twice in the file',
      '2 unreadable',
    ]);
    // Closed until tapped; one at a time.
    expect(screen.queryByTestId('transfer-chip-songs')).toBeNull();
    fireEvent.click(chip('liked'));
    expect(chip('liked')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('Copper Sky');
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('and 19 more');
    fireEvent.click(chip('double'));
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('Paper Lanterns');
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('Brought over once.');
    fireEvent.click(chip('bad'));
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('2 rows have no song Ember could read');
    fireEvent.click(chip('bad'));
    expect(screen.queryByTestId('transfer-chip-songs')).toBeNull();
  });

  it('Skip already liked is on to start with, takes them off the count and is sent with Start', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 120, alreadyLiked: 20 }));
    api.transferStart.mockResolvedValue({ job, playlistId: null });
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-skip-liked')).toBeInTheDocument());
    const skip = screen.getByTestId('transfer-skip-liked');
    expect(skip).toHaveAttribute('role', 'switch');
    expect(skip).toHaveAttribute('aria-checked', 'true');
    expect(skip).toHaveTextContent('Skip songs I already like');
    expect(startButton()).toHaveTextContent('Transfer 100 songs');
    expect(screen.getByTestId('transfer-preview-count')).toHaveTextContent('100');
    fireEvent.click(startButton());
    await waitFor(() => expect(api.transferStart).toHaveBeenCalled());
    expect(api.transferStart.mock.calls[0][0]).toMatchObject({ destination: 'liked', skipLiked: true });
  });

  it('turned off, every song goes, and nothing is skipped', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 120, alreadyLiked: 20 }));
    api.transferStart.mockResolvedValue({ job, playlistId: null });
    setup();
    toSpotifyFile();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-skip-liked')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('transfer-skip-liked'));
    expect(screen.getByTestId('transfer-skip-liked')).toHaveAttribute('aria-checked', 'false');
    expect(startButton()).toHaveTextContent('Transfer 120 songs');
    fireEvent.click(startButton());
    await waitFor(() => expect(api.transferStart).toHaveBeenCalled());
    expect(api.transferStart.mock.calls[0][0].skipLiked).toBeUndefined();
  });

  it('a new playlist has no already-liked chip and nothing to skip', async () => {
    api.transferPreview.mockResolvedValue(preview({ count: 120, alreadyLiked: 20 }));
    setup();
    pick('A new playlist');
    service('Spotify');
    have(/A file someone gave me/);
    toEnd();
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('transfer-preview')).toBeInTheDocument());
    expect(screen.getAllByTestId('transfer-chip').map((c) => c.dataset.chip)).toEqual(['new']);
    expect(screen.queryByTestId('transfer-skip-liked')).toBeNull();
    expect(startButton()).toHaveTextContent('Transfer 120 songs');
    expect(screen.getByTestId('transfer-preview-sentence')).toHaveTextContent('songs to bring into a new playlist');
  });

  it('a link going into the likes skips its already-liked songs too', async () => {
    api.importInspect.mockResolvedValue({
      source: 'spotify',
      id: 'x',
      name: 'Late night drive',
      coverUrl: null,
      items: [{ title: 'A', artist: 'X' }, { title: 'B', artist: 'Y' }, { title: 'C', artist: 'Z' }],
      truncated: false,
      liked: { count: 1, sample: [{ title: 'A', artist: 'X' }], newSample: [{ title: 'B', artist: 'Y' }] },
    });
    api.importStart.mockResolvedValue({ job: { ...job, source: 'spotify' }, playlistId: null });
    setup();
    pick('Liked songs');
    service('Spotify');
    have(/A link to a playlist/);
    toEnd();
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(chip('liked')).toHaveTextContent('1 already liked'));
    expect(startButton()).toHaveTextContent('Transfer 2 songs');
    fireEvent.click(startButton());
    await waitFor(() => expect(api.importStart).toHaveBeenCalledWith(LINK, 'liked', { skipLiked: true }));
  });

  it('a YourLibrary.json over the limit says how many are left over', async () => {
    api.transferPreview.mockResolvedValue(preview({ kind: 'spotify-export', count: 10_000, truncated: true, overLimit: 4_210 }));
    setup();
    toSpotifyFile();
    chooseFile('YourLibrary.json', '{"tracks":[]}');
    await waitFor(() => expect(chip('over')).toHaveTextContent('4,210 over the limit'));
    fireEvent.click(chip('over'));
    expect(screen.getByTestId('transfer-chip-songs')).toHaveTextContent('first 10,000');
  });
});

describe('TransferFlow: every service can fill the Liked songs', () => {
  function setupDefault() {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <TransferFlow />
      </QueryClientProvider>,
    );
  }

  it('is the default: every service is open', () => {
    expect([...LIKED_SERVICES_OPEN].sort()).toEqual([...ALL_SERVICES].sort());
  });

  it('shows every service enabled and not crossed out for Liked songs, with no held-back note', () => {
    setupDefault();
    pick('Liked songs');
    const cards = screen.getAllByTestId('transfer-service-card');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card).toBeEnabled();
      expect(card).not.toHaveClass('line-through');
    }
    expect(screen.queryByTestId('transfer-services-held-back')).toBeNull();
    expect(screen.queryByText(/For now only YouTube Music/)).toBeNull();
  });

  it('Spotify offers its data export first for Liked songs, the link last', () => {
    setupDefault();
    pick('Liked songs');
    service('Spotify');
    const routes = screen.getAllByTestId('transfer-have-option').map((o) => o.dataset.route);
    expect(routes).toEqual(['spotify-export', 'spotify-converter', 'spotify-link']);
  });

  it('Spotify still offers the link first for a new playlist', () => {
    setupDefault();
    pick('A new playlist');
    service('Spotify');
    expect(screen.getAllByTestId('transfer-have-option')[0].dataset.route).toBe('spotify-link');
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
