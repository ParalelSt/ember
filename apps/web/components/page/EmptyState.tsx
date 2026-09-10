import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Presentational only: the centred "Loading… / not found / nothing here"
 *  block every page uses between fetches. `className` carries the few
 *  variants (a smaller type size, a different colour). */
export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-muted-foreground py-12 text-center', className)}>{children}</div>;
}
