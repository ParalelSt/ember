import { Switch } from '@/components/ui/switch';
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
      <Switch
        data-testid="hide-tags-switch"
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label="Don't show New tags"
      />
    </div>
  );
}
