/** The tab page's stage (the owner's pick): the tab fills the screen under
 *  one thin title line, and a floating pill holds play, where you are,
 *  speed and loop. The pure bits it reads, kept out of the components so
 *  they can be tested on their own. */

import type { ScoreInfo } from '@/lib/tabScore';
import { barAtMs, type TabTimeline } from '@/lib/tabTimeline';
import { barCount, SPEED_PRESETS } from '@/lib/tabPractice';

/** The second line of the title: "Coastline · Rhythm guitar · 75%". The
 *  speed is always said, so 100% tells the song plays as recorded. */
export function stageMeta(artist: string, info: ScoreInfo | null, track: number, rate: number): string {
  const t = info?.tracks[track];
  return [artist, t ? t.name || t.instrument : '', `${Math.round(rate * 100)}%`].filter(Boolean).join(' · ');
}

/** The pill's speed button: each tap one preset slower, and from the
 *  slowest back to full speed. A speed between presets goes to the next
 *  preset under it. */
export function nextSlower(percent: number): number {
  const lower = [...SPEED_PRESETS].reverse().find((p) => p < Math.round(percent));
  return lower ?? 100;
}

/** Where the song is on the tab: the bar playing (1-based, as the tab
 *  numbers it) and how many bars there are. Before the first bar it is bar
 *  1; null while the tab's bars are not known. */
export function barPosition(timeline: TabTimeline | null, tabMs: number): { bar: number; total: number } | null {
  if (!timeline) return null;
  const total = barCount(timeline);
  if (total === 0) return null;
  const bar = barAtMs(timeline, tabMs);
  return { bar: (bar?.index ?? 0) + 1, total };
}
