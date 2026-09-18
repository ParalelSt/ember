import { cn } from '@/lib/utils';

export interface HideTagsSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

/** Presentational only: the persistent "Don't show New tags" switch. The
 *  track is the settings-style toggle (h-6 w-11, ember when on); the label
 *  sits to its left so the pair reads as one setting line. */
export function HideTagsSwitch({ checked, onCheckedChange, className }: HideTagsSwitchProps) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-3 text-sm', className)}>
      <span className="text-muted-foreground">Don&apos;t show New tags</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Don't show New tags"
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-ember' : 'bg-muted',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-white shadow-soft transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}
