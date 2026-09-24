import { Button } from '@/components/ui/button';

export interface ApplyBarProps {
  /** The theme the preview shows. */
  name: string;
  /** Its colours were changed (not only a different theme picked). */
  edited: boolean;
  /** Off while a pair is unreadable, the list is loading or it is applying. */
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

/** Shown while the preview differs from the theme in use: what is being
 *  tried, Apply (makes it the theme everywhere) and Back to current. Sticks
 *  to the top of the page, so it stays in reach while the colours scroll. */
export function ApplyBar({ name, edited, canApply, applying, onApply, onDiscard }: ApplyBarProps) {
  return (
    <div
      data-testid="apply-bar"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-row rounded-lg border border-ember/40 bg-card px-row py-cluster"
    >
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
    </div>
  );
}
