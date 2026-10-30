import { cn } from '@/lib/utils';

/** A theme at a glance, the top of its card: a small block of its background
 *  with a dot of its accent and one of its surface. All three come in through
 *  scoped custom properties, so no colour is named here. The block and the
 *  surface dot have a hairline, as a theme's surface can sit very close to its
 *  background, and its background to the page's. */
export function ThemeSwatch({
  background,
  accent,
  surface,
  className,
}: {
  background: string;
  accent: string;
  surface: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-testid="theme-swatch"
      className={cn(
        'flex h-14 w-full shrink-0 items-end gap-inset rounded-[10px] border border-border bg-(--swatch-bg) p-cluster',
        className,
      )}
      style={{
        ['--swatch-bg' as string]: background,
        ['--swatch-accent' as string]: accent,
        ['--swatch-surface' as string]: surface,
      }}
    >
      <span data-swatch-dot="accent" className="size-4 rounded-full bg-(--swatch-accent)" />
      <span data-swatch-dot="surface" className="size-4 rounded-full border border-border bg-(--swatch-surface)" />
    </span>
  );
}
