import type { Icon } from '@/components/icons';
import { ArrowDownIcon, ClockIcon, CloudArrowDownIcon, FolderSimplePlusIcon } from '@/components/icons';
import type { LibraryBadgeKind } from '@/lib/library';

export type { LibraryBadgeKind };

/** The Library's system collection looks, in ONE place: the gradient and
 *  white glyph of the Recently played, Uploads and Downloaded covers. Icons come from the shared Phosphor entry point, so every cover
 *  uses the same glyphs.
 *
 *  The colours are fixed art, the same in every theme (like the Liked songs
 *  cover), so they live here as literals rather than as theme tokens
 *  (lib/lintRules.test.ts allows this file by name). */

export type LibraryBadgeIcon = Icon;

export interface LibraryBadge {
  icon: LibraryBadgeIcon;
  /** The cover's 135deg gradient fill (the owner's "distinct" pick). */
  tile: string;
}

export const LIBRARY_BADGES: Record<LibraryBadgeKind, LibraryBadge> = {
  recent: { icon: ClockIcon, tile: 'linear-gradient(135deg, #246373, #88bfc3)' },
  uploads: { icon: FolderSimplePlusIcon, tile: 'linear-gradient(135deg, #a16a2c, #e6c785)' },
  downloaded: { icon: CloudArrowDownIcon, tile: 'linear-gradient(135deg, #245d46, #80bba0)' },
};

/** The Liked songs cover's gradient stops, top-left to bottom-right. */
export const LIKED_GRADIENT = { from: '#6544dc', to: '#b9c9ef' } as const;

/** A playlist with no art of its own (and fewer than four song covers): a
 *  charcoal tile with a soft gray music note. */
export const NEUTRAL_COVER = { background: '#232426', color: '#8c8e94' } as const;

/** The glyph colour on a badge and on a plain tile. */
export const LIBRARY_BADGE_FOREGROUND = '#ffffff';

/** The small green "downloaded" mark before a row's subtitle. */
export const DOWNLOADED_MARK = { icon: ArrowDownIcon as LibraryBadgeIcon, color: '#7fd1a0', foreground: '#08220f' };
