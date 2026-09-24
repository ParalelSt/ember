'use client';

import { CheckIcon, MinusIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** Presentational only: a tick box for picking songs. `mixed` is the Select
 *  all box's "some selected". The press never reaches the row underneath
 *  (a row in select mode toggles on its own click). A 40px hit box on a
 *  phone, 32px on desktop (docs/design-system.md section 2). */
export function Checkbox({
  checked,
  onChange,
  label,
  className,
  testId,
}: {
  checked: boolean | 'mixed';
  onChange: () => void;
  label: string;
  className?: string;
  testId?: string;
}) {
  const on = checked !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn('grid size-hit shrink-0 place-items-center rounded-md md:size-8', className)}
    >
      <span
        className={cn(
          'grid size-5 place-items-center rounded-md border-2 transition-colors',
          on ? 'border-ember bg-ember text-ember-foreground' : 'border-muted-foreground/60',
        )}
      >
        {checked === 'mixed' ? <MinusIcon className="size-3.5" /> : checked ? <CheckIcon className="size-3.5" /> : null}
      </span>
    </button>
  );
}
