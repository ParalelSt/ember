import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  title: ReactNode;
  /** Trailing control (a "Show all" link, a button). */
  action?: ReactNode;
  className?: string;
}

/** Presentational only: a section's `<h2>`, optionally with a trailing
 *  action. Without an action the heading is rendered bare, so sections that
 *  never had a header row keep their exact block layout. */
export function SectionHeader({ title, action, className }: SectionHeaderProps) {
  if (!action) return <h2 className={cn('text-section-title', className)}>{title}</h2>;
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <h2 className="text-section-title">{title}</h2>
      {action}
    </div>
  );
}
