import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Presentational only: a route's `<h1>`. `className` carries the per-page
 *  margin (pages differ: mb-2, mb-6, mb-8) and modifiers like truncate. */
export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cn('text-page-title', className)}>{children}</h1>;
}
