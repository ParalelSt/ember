import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  title: ReactNode;
  /** Trailing control (a "Show all" link, a button). */
  action?: ReactNode;
  className?: string;
  /** Replaces the heading's own type classes (`text-section-title`). The
   *  phone Home rows pass a bigger, one-line truncating title here. */
  titleClassName?: string;
}

/** Presentational only: a section's `<h2>`, optionally with a trailing
 *  action. Without an action the heading is rendered bare, so sections that
 *  never had a header row keep their exact block layout. */
export function SectionHeader({ title, action, className, titleClassName }: SectionHeaderProps) {
  const heading = titleClassName ?? 'text-section-title';
  if (!action) return <h2 className={cn(heading, className)}>{title}</h2>;
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <h2 className={heading}>{title}</h2>
      {action}
    </div>
  );
}
