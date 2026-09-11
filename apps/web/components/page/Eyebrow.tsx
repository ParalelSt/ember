import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Presentational only: the small uppercase label above a hero title. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-eyebrow', className)}>{children}</div>;
}
