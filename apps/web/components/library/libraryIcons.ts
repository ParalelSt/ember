import type { ComponentType } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ClockIcon } from '@/components/icons';
import type { LibraryBadgeKind } from '@/lib/library';

export type { LibraryBadgeKind };

/** The phone Library's system collection badges, in ONE place: the small
 *  round mark in the corner of the Recently played, Uploads and Downloaded
 *  mosaic covers (and the big glyph on their plain tile when there are no
 *  song covers yet). The icons are PROVISIONAL: the owner is picking an icon
 *  set separately, so swap them here and every cover follows.
 *
 *  The colours are fixed art, the same in every theme (like the Liked songs
 *  cover), so they live here as literals rather than as theme tokens
 *  (lib/lintRules.test.ts allows this file by name). */

export type LibraryBadgeIcon = ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;

export interface LibraryBadge {
  icon: LibraryBadgeIcon;
  /** The badge circle's fill. */
  color: string;
  /** The plain tile's fill when the collection has no song covers yet. */
  tile: string;
}

export const LIBRARY_BADGES: Record<LibraryBadgeKind, LibraryBadge> = {
  recent: { icon: ClockIcon, color: '#7a47e6', tile: 'linear-gradient(145deg, #7a47e6, #1c1040)' },
  uploads: { icon: ArrowUpIcon, color: '#2f74ea', tile: 'linear-gradient(145deg, #2f74ea, #0b2358)' },
  downloaded: { icon: ArrowDownIcon, color: '#18a870', tile: 'linear-gradient(145deg, #18a870, #07291d)' },
};

/** The glyph colour on a badge and on a plain tile. */
export const LIBRARY_BADGE_FOREGROUND = '#ffffff';

/** The small green "downloaded" mark before a row's subtitle. */
export const DOWNLOADED_MARK = { icon: ArrowDownIcon as LibraryBadgeIcon, color: '#7fd1a0', foreground: '#08220f' };
