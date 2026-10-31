import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type'> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** How the track looks when off: `muted` fills it, `outline` is a card
   *  with a border (used where the row sits on the page background). */
  variant?: 'muted' | 'outline';
}

/** The one Ember switch: a 44 by 24 pill (52 by 30 on phones), ember when on. Pass `aria-label`
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
        'relative h-6 w-11 max-md:h-7.5 max-md:w-13 shrink-0 rounded-full transition-colors motion-reduce:transition-none disabled:opacity-50',
        checked ? 'bg-ember' : variant === 'outline' ? 'bg-card border border-border' : 'bg-muted',
        className,
      )}
    >
      {/* left-0.5 is load-bearing: without an explicit inset the thumb falls
          back to its static position, which a button centres. */}
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 max-md:left-0.75 max-md:top-0.75 max-md:size-6 rounded-full shadow-sm transition-transform motion-reduce:transition-none',
          checked ? 'translate-x-5 max-md:translate-x-5.5 bg-ember-foreground' : 'bg-foreground',
        )}
      />
    </button>
  );
}

export interface ToggleRowProps extends SwitchProps {
  /** The row's own look; `className` stays the switch's, as on Switch. */
  rowClassName?: string;
  /** What the switch is about. Nothing clickable: it sits under the tap area. */
  children: ReactNode;
}

/** A settings row with its Switch. On phones the whole row flips it; from md up
 *  only the switch reacts.
 *
 *  The tap area is an empty sheet over the row, not a click handler on the row:
 *  the switch paints above it (later in the DOM, and positioned), so a tap lands
 *  on one or the other and can't toggle twice. It is display:none from md up, so
 *  desktop needs no width check, and it is invisible to keyboards and screen
 *  readers, so the Switch stays the one control with one name. */
export function ToggleRow({ rowClassName, children, ...switchProps }: ToggleRowProps) {
  const { checked, disabled, onCheckedChange } = switchProps;
  return (
    <div className={cn('relative', rowClassName)}>
      {children}
      {!disabled && (
        <div
          data-testid="toggle-row-tap"
          aria-hidden="true"
          onClick={() => onCheckedChange(!checked)}
          className="absolute inset-0 cursor-pointer md:hidden"
        />
      )}
      <Switch {...switchProps} />
    </div>
  );
}
