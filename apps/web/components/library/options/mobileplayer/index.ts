import type { Track } from '@/types/track';

/** Props every arrangement variant bar takes: the same shape the shipped
 *  `PhonePlayerBar` takes, so the picker can swap one variant for another
 *  without the frame around it caring which. The mock variants take
 *  `track.artworkUrl` straight (a prop), never `useTrackArtSrc` (a store
 *  read) — that hook is what makes `PhonePlayerBar` itself the one
 *  exception the layering rule allows in `components/player/**`. */
export interface ArrangementBarProps {
  track: Track;
  playing: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (sec: number) => void;
  onOpen: () => void;
  onQueue: () => void;
}

export type Arrangement =
  | 'before'
  | 'old-scroll'
  | 'old-play-only'
  | 'today'
  | 'art-with-name'
  | 'art-spans-both'
  | 'seek-on-top';

export interface ArrangementOption {
  id: Arrangement;
  name: string;
  description: string;
  badge?: string;
}

/** The four candidates the owner asked for, after "this still looks a tiny
 *  bit odd": the artwork sits below the title row, bottom-left, detached
 *  from the name it belongs to. 'today' is the shipped bar unchanged (the
 *  baseline to compare against); the other three all pull the artwork up
 *  next to the name, in three different shapes. */
export const ARRANGEMENTS: ArrangementOption[] = [
  {
    id: 'before',
    name: 'Before',
    description:
      'The phone bar as it was before the two-row change (PlayerBar.tsx, one row): artwork left, the ' +
      'truncated name beside it, transport centred, queue right. Shown honestly, bug included: it does ' +
      'not lift clear of Android’s system navigation, because its old chrome only trusted env() ' +
      'for the safe-area padding, which the WebView never reported.',
  },
  {
    id: 'old-scroll',
    name: 'Old + scrolling name',
    description:
      'The old one-row shape kept exactly (artwork left, transport and queue right, seek line pinned under ' +
      'everything, 93px bar), but the name scrolls with the same MarqueeText the full-screen view already uses ' +
      'instead of truncating. The transport moves from centred to beside the queue on the right, and gaps and ' +
      'padding tighten, so the name column grows from 38px to 152px at 390.',
  },
  {
    id: 'old-play-only',
    name: 'Old + play only',
    description:
      'The old one-row shape, stripped to just the artwork, the scrolling name and artist, and a single ' +
      'play/pause button. Previous, next and queue move to the full-screen view, reached by tapping the bar. ' +
      'With that room back, the name column measures 232px at 390, and play is raised to 48px.',
  },
  {
    id: 'today',
    name: 'Today',
    description: 'What ships now: name on its own row, artwork bottom-left of the transport row.',
  },
  {
    id: 'art-with-name',
    name: 'Art with the name',
    description:
      'Artwork moves up beside the title and artist (art left, name+artist stacked right, one row); the transport row sits below it, centred; the seek line is under that.',
    badge: 'Recommended',
  },
  {
    id: 'art-spans-both',
    name: 'Art spans both rows',
    description:
      'A larger artwork on the left spans the full height of the bar; the name row and the transport row stack beside it.',
  },
  {
    id: 'seek-on-top',
    name: 'Seek on top',
    description:
      'The seek line moves to the very top edge of the bar (a thin full-width line), then the name row (art beside the name, as in "Art with the name"), then the transport row.',
  },
];

/** One arrangement's measured numbers, for the section copy (ARRANGEMENT_METRICS below). */
export interface ArrangementMetrics {
  taps: string;
  titlePx390: number;
  titlePx360: number;
  barHeight: number;
}

/** Android's three-button navigation bar is 48dp tall, which is both the
 *  height of the mock strip drawn over the frame and the inset the frames
 *  publish as `--ember-inset-bottom`, standing in for what MainActivity
 *  publishes on a real phone. */
export const ANDROID_NAV_PX = 48;

/** Tap boxes, in CSS px, for the phone bar as it was before this. Google's
 *  own guidance is 48px, Apple's 44pt; the numbers below are what the owner
 *  was actually pressing. */
export const BEFORE_TAPS = 'play 40px, prev/next 32px, queue 40px, artwork 48px';

/** The width the old bar left for the song name at 390, measured in the
 *  mock shell: the grid was [1fr auto 1fr], so the left column was
 *  (390 - 32 padding - 32 gaps - 128 transport) / 2 = 98px, of which the
 *  48px artwork and its 12px gap took 60. */
export const BEFORE_TITLE_PX = 38;

/** "Old + play only" drops prev/next and queue from the minimised bar (they
 *  move to the full-screen view), so their tap-target sizes do not apply
 *  here; play is raised from the old bar's 40px to 48px, still inside the
 *  row's existing 48px content height. */
export const OLD_PLAY_ONLY_TAPS = 'play 48px, artwork 48px (prev/next/queue: full-screen view)';

/** What shipped, for the section copy. The numbers are asserted against the
 *  live bar by tests/mobile-player-ui.test.mjs, so they cannot drift. */
export const SHIPPED_TAPS = 'play 56px, prev/next 48px, queue 48px, artwork 48px';
export const SHIPPED_TITLE_PX = 358;

/** Each arrangement's measured numbers, for the section copy: tap targets
 *  are unchanged from what shipped in every candidate (none of the four
 *  touch play/prev/next/queue sizing), except "Art spans both rows", whose
 *  artwork is a deliberately larger 80x100px box rather than the 48px
 *  `size-art-sm` token the others keep. Title box and bar height were
 *  measured for real with `getBoundingClientRect` on the built gallery at
 *  390 and 360 (see the phone bar variants report in the scratchpad),
 *  divided by `ScaledFrame`'s own scale factor to read back CSS px. Putting
 *  the artwork beside the name costs it some title width and, for "Art
 *  with the name" and "Seek on top", a few px of extra bar height too (the
 *  title row is now as tall as the 48px artwork instead of just its own
 *  two lines of text); "Art spans both rows" keeps Today's exact bar
 *  height because its artwork stretches to fill the space the name and
 *  transport rows already needed, rather than growing the row that holds
 *  it. */
export const ARRANGEMENT_METRICS: Record<Arrangement, ArrangementMetrics> = {
  before: { taps: BEFORE_TAPS, titlePx390: BEFORE_TITLE_PX, titlePx360: 23, barHeight: 93 },
  'old-scroll': { taps: BEFORE_TAPS, titlePx390: 152, titlePx360: 122, barHeight: 92 },
  'old-play-only': { taps: OLD_PLAY_ONLY_TAPS, titlePx390: 232, titlePx360: 202, barHeight: 92 },
  today: { taps: SHIPPED_TAPS, titlePx390: SHIPPED_TITLE_PX, titlePx360: SHIPPED_TITLE_PX - 30, barHeight: 144 },
  'art-with-name': { taps: SHIPPED_TAPS, titlePx390: 296, titlePx360: 266, barHeight: 156 },
  'art-spans-both': {
    taps: 'play 56px, prev/next 48px, queue 48px, artwork 80x100px',
    titlePx390: 264,
    titlePx360: 234,
    barHeight: 144,
  },
  'seek-on-top': { taps: SHIPPED_TAPS, titlePx390: 296, titlePx360: 266, barHeight: 152 },
};
