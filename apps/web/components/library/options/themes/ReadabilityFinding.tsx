import { AlertIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';

/** A static stand-in for one row of `checkTheme`'s findings (plan section
 *  5 item 4): what a `fail` looks like in the editor, with its "Fix it"
 *  button. The real guard (`lib/theme/guard.ts`) does not exist yet
 *  (Task 1); this always shows the same line, on whichever gallery frame
 *  has `showWarning` set. */
export function ReadabilityFinding({ onFixIt }: { onFixIt?: () => void }) {
  return (
    <div
      data-testid="readability-finding"
      className="flex items-center justify-between gap-row rounded-md border border-destructive/40 bg-destructive/10 px-row py-inset text-xs text-destructive"
    >
      <span className="flex items-center gap-cluster">
        <AlertIcon className="h-3.5 w-3.5 shrink-0" />
        Muted text on cards: 2.4:1, hard to read.
      </span>
      <Button size="xs" variant="outline" onClick={onFixIt} className="shrink-0 border-destructive/40 text-destructive">
        Fix it
      </Button>
    </div>
  );
}
