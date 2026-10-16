import type { Icon } from '@/components/icons';
import { LIBRARY_BADGE_FOREGROUND } from '@/components/library/libraryIcons';
import { cn } from '@/lib/utils';

export interface GlyphTileProps {
  /** A CSS background (a gradient or a flat colour). */
  background: string;
  icon: Icon;
  /** The glyph colour; white by default. */
  color?: string;
  className?: string;
  'data-neutral-cover'?: boolean;
}

/** Presentational only: a square tile with one centered glyph a third of
 *  its width. The Library's system collection covers and the neutral
 *  playlist tile are both this. Fills its box; the box sets size and rounding. */
export function GlyphTile({ background, icon: Glyph, color = LIBRARY_BADGE_FOREGROUND, className, ...rest }: GlyphTileProps) {
  return (
    <span
      data-glyph-tile
      {...rest}
      aria-hidden="true"
      className={cn('grid aspect-square size-full place-items-center overflow-hidden', className)}
      style={{ background, color }}
    >
      <Glyph aria-hidden className="size-1/3" />
    </span>
  );
}
