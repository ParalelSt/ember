/** The small pictures beside each step of a way in: a mock of the screen
 *  the step happens on, with the row to tap outlined and a tap dot on it.
 *  Drawn in HTML and CSS by components/import/StepIllustration.tsx, so
 *  there is nothing to load and they follow the theme. One frame per step,
 *  in step order (lib/import/transferRoutes.ts). Pure data. */

export interface StepFrame {
  /** The app the screen belongs to, in the frame's top bar. */
  app: string;
  /** That app's colour, for the dot beside its name. */
  color: string;
  /** The screen's title. */
  title: string;
  rows: readonly string[];
  /** The row to tap, or -1 for none. */
  tap: number;
}

const EMBER = { app: 'Ember', color: '#ff5a4e' };
const SPOTIFY = { app: 'Spotify', color: '#1ed760' };
const YT_MUSIC = { app: 'YouTube Music', color: '#ff3b4a' };
const GOOGLE = { app: 'Google', color: '#6a8fe0' };
const FILES = { app: 'Files', color: '#6d86a8' };
const MAIL = { app: 'Mail', color: '#8aa86d' };

const emberFile: StepFrame = { ...EMBER, title: 'Transfer', rows: ['Choose a file'], tap: 0 };

export const STEP_FRAMES: Record<string, readonly StepFrame[]> = {
  'spotify-export': [
    { ...SPOTIFY, title: 'Account', rows: ['Edit profile', 'Privacy settings', 'Payment'], tap: 1 },
    { ...SPOTIFY, title: 'Privacy settings', rows: ['Personalised ads', 'Download your data: Request'], tap: 1 },
    { ...FILES, title: 'my_spotify_data.zip', rows: ['Spotify Account Data', 'YourLibrary.json', 'StreamingHistory0.json'], tap: 1 },
    emberFile,
  ],
  'spotify-converter': [
    { app: 'Exportify', color: '#7fd1a0', title: 'exportify.net', rows: ['Log in with Spotify', 'Liked Songs: Export'], tap: 1 },
    emberFile,
  ],
  'spotify-link': [
    { ...SPOTIFY, title: 'Liked Songs', rows: ['Select all', 'Add to playlist: New playlist'], tap: 1 },
    { ...SPOTIFY, title: 'My liked copy', rows: ['Make public', 'Share: Copy link to playlist'], tap: 1 },
    { ...EMBER, title: 'Transfer', rows: ['Paste the Spotify playlist link'], tap: 0 },
  ],
  'ytmusic-google': [
    { ...EMBER, title: 'Transfer', rows: ['Sign in with Google'], tap: 0 },
    { ...GOOGLE, title: 'google.com/device', rows: ['Enter the code', 'Pick your YouTube Music account'], tap: 0 },
    { ...GOOGLE, title: 'Ember wants to see your YouTube account', rows: ['Cancel', 'Allow'], tap: 1 },
  ],
  'ytmusic-link': [
    { ...YT_MUSIC, title: 'Library', rows: ['Liked', 'Add all to a new playlist'], tap: 1 },
    { ...YT_MUSIC, title: 'My likes', rows: ['Make public', 'Share: Copy link'], tap: 1 },
    { ...EMBER, title: 'Transfer', rows: ['Paste the YouTube Music playlist link'], tap: 0 },
  ],
  'apple-export': [
    { app: 'privacy.apple.com', color: '#fc5c7d', title: 'Data and privacy', rows: ['Request a copy of your data', 'Apple Media Services'], tap: 1 },
    { ...MAIL, title: 'Your data is ready', rows: ['From Apple, a few days later', 'Download'], tap: 1 },
    { ...FILES, title: 'Apple Media Services', rows: ['Apple Music Activity', 'Apple Music Likes and Dislikes.csv'], tap: 1 },
    emberFile,
  ],
  'other-paste': [
    { app: 'Notes', color: '#c9a227', title: 'My songs', rows: ['June Harbor - Paper Lanterns', 'Mira Vale - Northbound', 'Coastline - Copper Sky'], tap: -1 },
    { ...EMBER, title: 'Transfer', rows: ['Paste your list'], tap: 0 },
  ],
  'other-file': [
    { ...FILES, title: 'Downloads', rows: ['songs-from-tidal.csv', 'holiday.jpg'], tap: 0 },
    emberFile,
  ],
};

/** The picture for one step, or null when a route has none for it. */
export function stepFrame(routeId: string, step: number): StepFrame | null {
  return STEP_FRAMES[routeId]?.[step] ?? null;
}
