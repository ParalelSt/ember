import { useState } from 'react';
import { cn } from '@/lib/utils';

/** "Share with everyone" (owner decision 3): a plain switch, the same
 *  pattern PrivacyToggles.tsx uses (the UI kit has no Switch component). On
 *  turning it on, this theme appears in every other account's "Shared by
 *  others" section, labelled "by <your name>"; turning it off hides it
 *  again, but people already using it keep a copy of its values so nothing
 *  breaks under them. Locally interactive so the owner can click it, not
 *  wired to anything. */
export function ShareToggleRow({ checked: initial }: { checked: boolean }) {
  const [checked, setChecked] = useState(initial);
  return (
    <div className="flex items-start justify-between gap-row border-t border-border pt-stack">
      <div className="min-w-0">
        <div className="text-sm font-medium">Share with everyone</div>
        <p className="mt-inset text-xs text-muted-foreground">
          Anyone on this Ember server can pick this theme, labelled &quot;by you&quot;. Turning it off
          hides it again; people already using it keep their own copy.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Share with everyone"
        onClick={() => setChecked((c) => !c)}
        className={cn(
          'relative mt-inset h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-ember' : 'border border-border bg-card',
        )}
      >
        <span
          className={cn(
            'absolute left-0 top-0.5 h-5 w-5 rounded-full bg-foreground transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
