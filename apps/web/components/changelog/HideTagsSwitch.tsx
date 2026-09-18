import { cn } from '@/lib/utils';

export interface HideTagsSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

/** Presentational only: the persistent "Don't show New tags" switch. Same
 *  track and thumb as the automatic crash reports toggle on Settings > Help;
 *  the label sits to its left so the pair reads as one setting line. */
export function HideTagsSwitch({ checked, onCheckedChange, className }: HideTagsSwitchProps) {
  return (
    <div className={cn('flex items-center gap-3 text-sm', className)}>
      <span className="text-muted-foreground" aria-hidden="true">
        Don&apos;t show New tags
      </span>
      <button
        type="button"
        data-testid="hide-tags-switch"
        onClick={() => onCheckedChange(!checked)}
        aria-pressed={checked}
        aria-label="Don't show New tags"
        className={cn('shrink-0 relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-ember' : 'bg-muted')}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}
