import type { Icon } from '@/components/icons';
import { ArrowDownIcon, ClockIcon, CloudArrowDownIcon, FolderSimplePlusIcon } from '@/components/icons';
import type { LibraryBadgeKind } from '@/lib/library';

export type { LibraryBadgeKind };

/** The phone Library's system collection badges, in ONE place: the small
 *  round mark in the corner of the Recently played, Uploads and Downloaded
 *  mosaic covers (and the big glyph on their plain tile when there are no
 *  song covers yet). Icons come from the shared Phosphor entry point, so every cover
 *  uses the same glyphs.
 *
 *  The colours are fixed art, the same in every theme (like the Liked songs
 *  cover), so they live here as literals rather than as theme tokens
 *  (lib/lintRules.test.ts allows this file by name). */

export type LibraryBadgeIcon = Icon;

export interface LibraryBadge {
  icon: LibraryBadgeIcon;
  /** The badge circle's fill. */
  color: string;
  /** The plain tile's fill when the collection has no song covers yet. */
  tile: string;
}

export const LIBRARY_BADGES: Record<LibraryBadgeKind, LibraryBadge> = {
  recent: { icon: ClockIcon, color: '#f2514a', tile: 'linear-gradient(145deg, #f2514a, #3a0b1c)' },
  uploads: { icon: FolderSimplePlusIcon, color: '#e8912d', tile: 'linear-gradient(145deg, #e8912d, #3d1f06)' },
  downloaded: { icon: CloudArrowDownIcon, color: '#d9547a', tile: 'linear-gradient(145deg, #d9547a, #33101f)' },
};

/** The glyph colour on a badge and on a plain tile. */
export const LIBRARY_BADGE_FOREGROUND = '#ffffff';

/** The small green "downloaded" mark before a row's subtitle. */
export const DOWNLOADED_MARK = { icon: ArrowDownIcon as LibraryBadgeIcon, color: '#7fd1a0', foreground: '#08220f' };
