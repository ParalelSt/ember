import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RadioPage from './page';
import { stationTrack, type RadioStation } from '@/lib/radio/station';
import { useUiStore } from '@/stores/useUiStore';

/** The Radio page: Croatia until the listener shares where they are (no
 *  prompt until they tap), their favourites, a search; a tap plays the
 *  station with the list around it, and the heart keeps a favourite. */

const station = (n: number, name: string): RadioStation => {
  const base = { id: `00000000-0000-4000-8000-00000000000${n}`, name, favicon: null, country: 'Croatia', countryCode: 'HR', state: '', codec: 'MP3', bitrate: 128, votes: 1, distanceKm: null };
  return { ...base, track: stationTrack(base) };
};
const HR = [station(1, 'Otvoreni'), station(2, 'Narodni')];
const NEAR = [station(3, 'Radio Sljeme')];
const FOUND = [station(4, 'Antena Zagreb')];

const api = vi.hoisted(() => ({
  radioCountry: vi.fn(),
  radioNearby: vi.fn(),
  radioSearch: vi.fn(),
  radioFavorites: vi.fn(),
  addRadioFavorite: vi.fn(),
  removeRadioFavorite: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/components/OnlineOnly', () => ({ OnlineOnly: ({ children }: { children: React.ReactNode }) => children }));
const player = vi.hoisted(() => ({ playTrack: vi.fn(), toggle: vi.fn() }));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ current: null, isPlaying: false, ...player }),
}));

const getCurrentPosition = vi.fn();
let permission = 'prompt';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RadioPage /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ radioQuery: '' });
  permission = 'prompt';
  api.radioCountry.mockResolvedValue({ stations: HR });
  api.radioNearby.mockResolvedValue({ stations: NEAR });
  api.radioSearch.mockResolvedValue({ stations: FOUND });
  api.radioFavorites.mockResolvedValue({ stations: [] });
  api.addRadioFavorite.mockResolvedValue({ station: HR[0] });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: permission }) } });
  getCurrentPosition.mockImplementation((ok: (p: unknown) => void) => ok({ coords: { latitude: 45.81444, longitude: 15.97798 } }));
});

describe('Radio page', () => {
  it('shows Croatia without asking where the listener is', async () => {
    renderPage();
    expect(await screen.findByText('Otvoreni')).toBeTruthy();
    expect(api.radioCountry).toHaveBeenCalledWith('HR');
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(api.radioNearby).not.toHaveBeenCalled();
  });

  it('"Use my location" lists stations near them, sending only a rounded point', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /use my location/i }));
    expect(await screen.findByText('Radio Sljeme')).toBeTruthy();
    expect(api.radioNearby).toHaveBeenCalledWith(45.8, 16);
  });

  it('uses the location straight away when the site already may read it', async () => {
    permission = 'granted';
    renderPage();
    expect(await screen.findByText('Radio Sljeme')).toBeTruthy();
  });

  it('plays a station with its list, as live radio', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Narodni'));
    expect(player.playTrack).toHaveBeenCalledWith(HR[1].track, [HR[0].track, HR[1].track], { type: 'stations', name: 'Croatia' });
  });

  it('the heart adds a favourite station, which then gets its own list', async () => {
    renderPage();
    await screen.findByText('Otvoreni');
    api.radioFavorites.mockResolvedValue({ stations: [HR[0]] });
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Otvoreni' }));
    await waitFor(() => expect(api.addRadioFavorite).toHaveBeenCalledWith(HR[0].id));
    expect(await screen.findByText('Favourites')).toBeTruthy();
  });

  it('shows the favourites first, then the stations around, as shelves of logo tiles with name, region and distance', async () => {
    api.radioFavorites.mockResolvedValue({ stations: [HR[1]] });
    const near = { ...NEAR[0], distanceKm: 3.2, state: 'Zagreb' };
    const nearRows = [{ ...near, track: stationTrack(near) }, { ...station(5, 'HR 2'), distanceKm: 0.4 }];
    api.radioNearby.mockResolvedValue({ stations: nearRows });
    permission = 'granted';
    renderPage();
    await screen.findByText('Favourites');
    await screen.findByText('Radio Sljeme');
    expect(screen.queryByTestId('station-list')).toBeNull();
    const favs = screen.getByRole('region', { name: 'Favourites' });
    const around = screen.getByRole('region', { name: 'Nearby' });
    expect(within(favs).getByText('Narodni')).toBeTruthy();
    expect(within(favs).getByText('Croatia')).toBeTruthy();
    expect(within(around).getByText('Zagreb · 3 km')).toBeTruthy();
    expect(within(around).getByText('Croatia · Under 1 km')).toBeTruthy();
    expect(within(around).getAllByTestId('station-tile')).toHaveLength(2);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.indexOf('Favourites')).toBeLessThan(headings.indexOf('Nearby'));
  });

  it('holds every station of a section in its shelf, with no "Show all"', async () => {
    const many = Array.from({ length: 14 }, (_, i) => station(i, `Station ${i}`)).map((s, i) => ({ ...s, id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}` }));
    api.radioCountry.mockResolvedValue({ stations: many });
    renderPage();
    await screen.findByText('Station 13');
    expect(within(screen.getByRole('region', { name: 'Croatia' })).getAllByRole('listitem')).toHaveLength(14);
    expect(screen.queryByText('Show all')).toBeNull();
  });

  it('keeps "Use my location" beside the Croatia shelf', async () => {
    renderPage();
    await screen.findByText('Otvoreni');
    const shelf = screen.getByRole('region', { name: 'Croatia' });
    expect(within(shelf).getByText('Otvoreni')).toBeTruthy();
    expect(within(shelf).getByRole('button', { name: /use my location/i })).toBeTruthy();
  });

  it('the heart on a tile keeps a favourite without playing the station', async () => {
    renderPage();
    await screen.findByText('Otvoreni');
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Narodni' }));
    await waitFor(() => expect(api.addRadioFavorite).toHaveBeenCalledWith(HR[1].id));
    expect(player.playTrack).not.toHaveBeenCalled();
  });

  it('keeps the wording while the stations load and when radio cannot be reached', async () => {
    api.radioCountry.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderPage();
    expect(await within(screen.getByRole('region', { name: 'Croatia' })).findByText('Loading…')).toBeTruthy();
    unmount();
    api.radioCountry.mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText("Radio isn't reachable right now. Try again in a moment.")).toBeTruthy();
    expect(screen.getByRole('button', { name: /use my location/i })).toBeTruthy();
  });

  it('lists search finds as rows, not a shelf', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search stations'), { target: { value: 'antena' } });
    expect(await screen.findByText('Antena Zagreb')).toBeTruthy();
    expect(screen.getByTestId('station-list')).toBeTruthy();
    expect(screen.queryByTestId('station-tile')).toBeNull();
  });

  it('searches stations by name', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search stations'), { target: { value: 'antena' } });
    expect(await screen.findByText('Antena Zagreb')).toBeTruthy();
    expect(api.radioSearch).toHaveBeenCalledWith('antena');
  });

  it('keeps its own search box for phones only: the desktop top bar types the same query', async () => {
    renderPage();
    expect(screen.getByLabelText('Search stations').parentElement).toHaveClass('md:hidden');
    // What the top bar's box (SearchOverlayContainer on /radio) types.
    useUiStore.getState().setRadioQuery('antena');
    expect(await screen.findByText('Antena Zagreb')).toBeTruthy();
    expect(api.radioSearch).toHaveBeenCalledWith('antena');
    expect(screen.getByLabelText('Search stations')).toHaveValue('antena');
  });

  it('empties the station search when the page is left', () => {
    const { unmount } = renderPage();
    fireEvent.change(screen.getByLabelText('Search stations'), { target: { value: 'antena' } });
    expect(useUiStore.getState().radioQuery).toBe('antena');
    unmount();
    expect(useUiStore.getState().radioQuery).toBe('');
  });
});
