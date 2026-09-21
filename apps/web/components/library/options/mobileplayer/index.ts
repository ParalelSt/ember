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

/** What ships: the owner's pick, "Old + play only", at the Balanced size
 *  with a smaller disc ("the button is too big while the rest is good").
 *  Next sits beside play (added after "it looks pretty empty"); previous
 *  and the queue live on the full-screen view. The title box and bar height were measured on the
 *  built gallery and are asserted (as floors) against the live bar by
 *  tests/mobile-player-ui.test.mjs. */
export const SHIPPED_TAPS =
  'play 48px (a 40px disc inside it), next 48px (24px glyph), artwork 56px (previous and queue: full-screen view)';
export const SHIPPED_TITLE_PX_390 = 176;
export const SHIPPED_TITLE_PX_360 = 146;
export const SHIPPED_BAR_HEIGHT = 100;
