'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** The small label under the icon ("Tabs", "EQ", "Pixel Buds"). */
  label: string;
  /** The accessible name and tooltip, when it says more than the label. */
  ariaLabel?: string;
  onClick: () => void;
  /** Ember-coloured: the tool is on (the equalizer, another output). */
  lit?: boolean;
  className?: string;
  children: ReactNode;
  'data-testid'?: string;
}

/** One tool in the row under the full-screen player's controls: an icon
 *  over a small label, the whole cell one tap target. */
export function PlayerToolButton({ label, ariaLabel, onClick, lit, className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      title={ariaLabel ?? label}
      data-testid={rest['data-testid']}
      className={cn(
        'flex min-h-14 min-w-0 flex-col items-center justify-center gap-inset rounded-xl px-inset transition-colors hover:bg-foreground/5',
        lit ? 'text-ember' : 'text-foreground/80 hover:text-foreground',
        className,
      )}
    >
      {children}
      <span className="max-w-full truncate text-[11px] font-medium">{label}</span>
    </button>
  );
}
