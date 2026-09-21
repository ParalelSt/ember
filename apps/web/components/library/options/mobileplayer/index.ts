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

/** What shipped, for the section copy. The numbers are asserted against the
 *  live bar by tests/mobile-player-ui.test.mjs, so they cannot drift. */
export const SHIPPED_TAPS = 'play 56px, prev/next 48px, queue 48px, artwork 48px';
export const SHIPPED_TITLE_PX = 358;
