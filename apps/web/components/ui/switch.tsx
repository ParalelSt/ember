import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type'> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** How the track looks when off: `muted` fills it, `outline` is a card
   *  with a border (used where the row sits on the page background). */
  variant?: 'muted' | 'outline';
}

/** The one Ember switch: a 44 by 24 pill, ember when on. Pass `aria-label`
 *  (or an `id` a `<label htmlFor>` points at) like any button. */
export function Switch({ checked, onCheckedChange, variant = 'muted', className, ...rest }: SwitchProps) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none disabled:opacity-50',
        checked ? 'bg-ember' : variant === 'outline' ? 'bg-card border border-border' : 'bg-muted',
        className,
      )}
    >
      {/* left-0.5 is load-bearing: without an explicit inset the thumb falls
          back to its static position, which a button centres. */}
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none',
          checked ? 'translate-x-5 bg-ember-foreground' : 'bg-foreground',
        )}
      />
    </button>
  );
}
