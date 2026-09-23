import { cn } from '@/lib/utils';

/** A theme at a glance: its background as the fill, its accent as a ring.
 *  Both come in through scoped custom properties, so no colour is named
 *  here. */
export function ThemeSwatch({ background, accent, className }: { background: string; accent: string; className?: string }) {
  return (
    <span
      aria-hidden
      data-testid="theme-swatch"
      className={cn(
        'block size-hit shrink-0 rounded-full border border-border bg-(--swatch-bg) shadow-[inset_0_0_0_3px_var(--swatch-ring)]',
        className,
      )}
      style={{ ['--swatch-bg' as string]: background, ['--swatch-ring' as string]: accent }}
    />
  );
}
