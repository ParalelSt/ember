import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ApplyBarProps {
  /** The preview differs from the theme in use. */
  dirty: boolean;
  /** The theme the preview shows. */
  name: string;
  /** The theme the app uses. */
  inUseName: string;
  /** Its colours were changed (not only a different theme picked). */
  edited: boolean;
  /** Off while a pair is unreadable or the list is loading. */
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

/** The inspector's header line. With nothing to apply it names the theme in
 *  use; while the preview differs it says what is being tried, with Apply
 *  (makes it the theme everywhere) and Back to current. It keeps one height
 *  either way, so the list under it does not jump when a pick makes it
 *  appear, and it sticks to the top of the page while there is something
 *  to apply, so it stays in reach while the colours scroll. */
export function ApplyBar({ dirty, name, inUseName, edited, canApply, applying, onApply, onDiscard }: ApplyBarProps) {
  return (
    <div
      data-testid={dirty ? 'apply-bar' : 'in-use-bar'}
      className={cn(
        'flex min-h-16 flex-wrap items-center gap-row rounded-lg border px-row py-cluster',
        dirty ? 'sticky top-0 z-10 border-ember/40 bg-card' : 'border-border',
      )}
    >
      {dirty ? (
        <>
          <p className="min-w-0 flex-1 text-sm">
            {edited ? (
              <>
                Your changes to <span className="font-medium">{name}</span> show in the preview only.
              </>
            ) : (
              <>
                <span className="font-medium">{name}</span> shows in the preview only.
              </>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-cluster">
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              Back to current
            </Button>
            <Button size="sm" variant="ember" onClick={onApply} disabled={!canApply || applying}>
              {applying ? 'Applying' : 'Apply'}
            </Button>
          </div>
        </>
      ) : (
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          In use: <span className="font-medium text-foreground">{inUseName}</span>. Pick a theme or change a colour to
          try it in the preview.
        </p>
      )}
    </div>
  );
}
