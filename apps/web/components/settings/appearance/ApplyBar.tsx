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
  /** Without its card (desktop Settings rows); the page's background keeps
   *  it readable while it sticks. */
  bare?: boolean;
}

/** The inspector's header line, a soft filled block. With nothing to apply it names the theme in
 *  use; while the preview differs it says what is being tried, with Apply
 *  (makes it the theme everywhere) and Back to current. It keeps one height
 *  in every state: the other states' lines sit under the shown one, unseen,
 *  in the same cell of a grid, so the bar is always as tall as its tallest
 *  state and the tabs under it never jump when a pick or a colour change
 *  makes Apply appear (or Apply takes it away again; layout-shift pass). It
 *  sticks under the top bar while there is something to apply, so it stays
 *  in reach while the colours scroll. */
export function ApplyBar({ dirty, name, inUseName, edited, canApply, applying, onApply, onDiscard, bare }: ApplyBarProps) {
  const tried = (changed: boolean) => (
    <>
      <p className="min-w-0 flex-1 text-sm">
        {changed ? (
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
  );
  const inUse = (
    <p className="min-w-0 flex-1 text-sm text-muted-foreground">
      In use: <span className="font-medium text-foreground">{inUseName}</span>. Pick a theme or change a colour to
      try it in the preview.
    </p>
  );
  const LAYER = 'col-start-1 row-start-1 flex flex-wrap items-center gap-row';
  return (
    <div
      data-testid={dirty ? 'apply-bar' : 'in-use-bar'}
      className={cn(
        'grid min-h-16 items-center',
        bare ? 'py-row' : 'rounded-[12px] bg-card p-row',
        // On desktop it sticks just under the top bar's cover, where the
        // preview sticks too, and paints over the cover's fade.
        dirty && 'sticky top-0 z-30 md:top-[calc(var(--ember-topbar-h,0px)+var(--spacing-block))]',
        dirty && bare && 'bg-background',
      )}
    >
      <div className={LAYER}>{dirty ? tried(edited) : inUse}</div>
      {/* The states not shown, for their height only. */}
      <div aria-hidden inert data-testid="apply-bar-room" className={cn(LAYER, 'invisible')}>
        {tried(true)}
      </div>
      <div aria-hidden inert className={cn(LAYER, 'invisible')}>
        {inUse}
      </div>
    </div>
  );
}
