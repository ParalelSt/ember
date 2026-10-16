import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

/** The one look every floating action shares, taken from Back to top
 *  (components/nav/BackToTop.tsx): ember fill, round, the soft ember glow.
 *  Restyle floating actions here, not at call sites. */
export const FLOATING_ACTION_CLASS =
  'inline-flex h-12 min-w-12 items-center justify-center gap-cluster rounded-full bg-ember text-ember-foreground font-semibold shadow-glow transition-colors hover:bg-ember-soft disabled:opacity-50 disabled:pointer-events-none';

interface FloatingActionButtonProps {
  /** With a label it is a pill (icon, then the words); without one a round
   *  icon button, so `aria-label` is required then. */
  label?: string;
  icon?: ComponentType<{ className?: string }>;
  'aria-label'?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/** Phone-only floating action, bottom right, above the mini player.
 *
 *  Placed `absolute`, which resolves against the app's content column
 *  (app/(app)/layout.tsx gives it `relative`; nothing between it and a page
 *  is positioned), the same place Back to top floats, so it sits just above
 *  the player bar and does not scroll with the page. `data-fab` lets
 *  globals.css lift Back to top over it. Hidden from md up: desktop pages
 *  keep their header buttons. Pages that show it leave room under their
 *  last row (pb-stack) so the button never covers it. */
export function FloatingActionButton({ label, icon: Icon, onClick, disabled, className, ...rest }: FloatingActionButtonProps) {
  return (
    <button
      type="button"
      data-fab
      data-slot="fab"
      onClick={onClick}
      disabled={disabled}
      aria-label={rest['aria-label'] ?? label}
      className={cn(
        FLOATING_ACTION_CLASS,
        'absolute right-6 bottom-cluster z-40 md:hidden',
        label ? 'px-block' : 'w-12',
        className,
      )}
    >
      {Icon && <Icon className={label ? 'size-5' : 'size-6'} />}
      {label}
    </button>
  );
}
