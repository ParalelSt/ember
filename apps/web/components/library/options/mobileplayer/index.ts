import type { PickerOption } from '@/components/library/options';
import type { PhoneBarSize, PhonePlayStyle } from '@/components/player/PhonePlayerBar';

/** Android's three-button navigation bar is 48dp tall, which is both the
 *  height of the mock strip drawn over the frame and the inset the frames
 *  publish as `--ember-inset-bottom`, standing in for what MainActivity
 *  publishes on a real phone. */
export const ANDROID_NAV_PX = 48;

/** Tap boxes, in CSS px, for the phone bar as it was before this work.
 *  Google's own guidance is 48px, Apple's 44pt; the numbers below are what
 *  the owner was actually pressing. */
export const BEFORE_TAPS = 'play 40px, prev/next 32px, queue 40px, artwork 48px';

/** The width the old bar left for the song name at 390: the grid was
 *  [1fr auto 1fr], so the left column was (390 - 32 padding - 32 gaps -
 *  128 transport) / 2 = 98px, of which the 48px artwork and its 12px gap
 *  took 60. */
export const BEFORE_TITLE_PX = 38;

/** What ships: the owner's pick, "Old + play only". Previous, next and the
 *  queue are not in the bar; they live on the full-screen view. The title
 *  box and bar height were measured on the built gallery and are asserted
 *  (as floors) against the live bar by tests/mobile-player-ui.test.mjs. */
export const SHIPPED_TAPS = 'play 48px, artwork 48px (previous, next and queue: full-screen view)';
export const SHIPPED_TITLE_PX_390 = 232;
export const SHIPPED_TITLE_PX_360 = 202;
export const SHIPPED_BAR_HEIGHT = 92;

/** The "Bar size" picker: size presets for the phone bar, after the owner
 *  asked for the play button, the artwork and the name to be resized. Each
 *  id is a real `PhoneBarSize` preset in PhonePlayerBar.tsx; the gallery
 *  renders the real bar with it. The live bar stays on `today` until one is
 *  picked. */
export const PHONE_BAR_SIZE_OPTIONS: (PickerOption & { id: PhoneBarSize; badge?: string })[] = [
  { id: 'today', name: 'Today', description: 'Exactly what ships: artwork 48, play disc 48, name 14px, artist 12px, bar 92.' },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Artwork 56, play disc 40 in a 48 hit box, name 16px, artist 14px, bar 100.',
    badge: 'Recommended',
  },
  { id: 'art', name: 'Art forward', description: 'Artwork 64, play disc 44 in a 48 hit box, name 16px, artist 14px, tighter padding, bar 104.' },
  { id: 'compact', name: 'Compact', description: 'Artwork 48, play disc 40 in a 48 hit box, name 16px, artist 14px, a shorter row, bar 84.' },
];

/** The "Play style" picker: the same hit box either way. */
export const PHONE_PLAY_STYLE_OPTIONS: (PickerOption & { id: PhonePlayStyle; badge?: string })[] = [
  { id: 'disc', name: 'Filled disc', description: "Today's solid white circle with a dark glyph." },
  {
    id: 'icon',
    name: 'Icon only',
    description: 'The play/pause glyph in the text colour, no disc, same hit box.',
    badge: 'Recommended',
  },
];

/** What each preset measures, in CSS px, read from the built gallery's DOM
 *  (offsetWidth/offsetHeight and computed font sizes, so the frames'
 *  scaling does not skew them). `play` is the visible disc, `glyph` the
 *  bare icon in the icon-only style; `bar` is the bar without the safe-area
 *  inset; `name390`/`name360` the song name's box. tests/phone-bar-sizes-ui
 *  .test.mjs re-measures them against the live gallery. */
export interface PhoneBarMeasure {
  art: number;
  play: number;
  glyph: number;
  hit: number;
  title: number;
  artist: number;
  bar: number;
  name390: number;
  name360: number;
}

export const PHONE_BAR_MEASURED: Record<PhoneBarSize, PhoneBarMeasure> = {
  today: { art: 48, play: 48, glyph: 28, hit: 48, title: 14, artist: 12, bar: 92, name390: 232, name360: 202 },
  balanced: { art: 56, play: 40, glyph: 28, hit: 48, title: 16, artist: 14, bar: 100, name390: 224, name360: 194 },
  art: { art: 64, play: 44, glyph: 28, hit: 48, title: 16, artist: 14, bar: 104, name390: 216, name360: 186 },
  compact: { art: 48, play: 40, glyph: 28, hit: 48, title: 16, artist: 14, bar: 84, name390: 232, name360: 202 },
};

/** The combination marked Recommended in the section copy. */
export const RECOMMENDED_PHONE_BAR = { size: 'balanced', playStyle: 'icon' } as const satisfies {
  size: PhoneBarSize;
  playStyle: PhonePlayStyle;
};
