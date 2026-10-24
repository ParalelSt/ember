import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RadioPage from './page';
import { stationTrack, type RadioStation } from '@/lib/radio/station';

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

  it('lists the favourites first, then the stations around, as rows with logo, name, town and distance', async () => {
    api.radioFavorites.mockResolvedValue({ stations: [HR[1]] });
    const near = { ...NEAR[0], distanceKm: 3.2, state: 'Zagreb' };
    const nearRows = [{ ...near, track: stationTrack(near) }, { ...station(5, 'HR 2'), distanceKm: 0.4 }];
    api.radioNearby.mockResolvedValue({ stations: nearRows });
    permission = 'granted';
    renderPage();
    await screen.findByText('Favourites');
    await screen.findByText('Radio Sljeme');
    const [favs, around] = screen.getAllByTestId('station-list');
    expect(within(favs).getByText('Narodni')).toBeTruthy();
    expect(within(favs).queryByTestId('station-distance')).toBeNull();
    expect(within(around).getByText('Zagreb, Croatia')).toBeTruthy();
    expect(within(around).getAllByTestId('station-distance').map((d) => d.textContent)).toEqual(['3 km', 'Under 1 km']);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.indexOf('Favourites')).toBeLessThan(headings.indexOf('Nearby'));
  });

  it('searches stations by name', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search stations'), { target: { value: 'antena' } });
    expect(await screen.findByText('Antena Zagreb')).toBeTruthy();
    expect(api.radioSearch).toHaveBeenCalledWith('antena');
  });
});
