import type { MouseEventHandler, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ArtworkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// The five artwork sizes from globals.css (@theme --spacing-art-*), so a
// call site names the size instead of repeating an h-N w-N pair.
const SIZES: Record<ArtworkSize, string> = {
  xs: 'size-art-xs',
  sm: 'size-art-sm',
  md: 'size-art-md',
  lg: 'size-art-lg',
  xl: 'size-art-xl',
};

export interface ArtworkProps {
  src?: string | null;
  alt?: string;
  /** Omit on cards that size themselves (aspect-square w-full in
   *  `className`); pass a token size for the fixed boxes. */
  size?: ArtworkSize;
  shape?: 'square' | 'round';
  /** 'gradient' paints the ember cover placeholder behind the image, for
   *  collection covers; most rows want the flat 'none' plus a bg class. */
  fallback?: 'none' | 'gradient';
  className?: string;
  imgClassName?: string;
  loading?: 'lazy' | 'eager';
  onClick?: MouseEventHandler<HTMLDivElement>;
  /** Rendered instead of the image when there is no `src` (icon, initials). */
  children?: ReactNode;
}

/** Presentational only: a square (or round) box holding cover art. The box
 *  owns the size, radius and background so the image can always fill it,
 *  which is why the img is absolutely positioned rather than sized itself. */
export function Artwork({
  src,
  alt = '',
  size,
  shape = 'square',
  fallback = 'none',
  className,
  imgClassName,
  loading,
  onClick,
  children,
}: ArtworkProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative overflow-hidden',
        size && SIZES[size],
        shape === 'round' && 'rounded-full',
        fallback === 'gradient' && 'cover-placeholder',
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading={loading}
          className={cn('absolute inset-0 h-full w-full object-cover', imgClassName)}
        />
      ) : (
        children
      )}
    </div>
  );
}
