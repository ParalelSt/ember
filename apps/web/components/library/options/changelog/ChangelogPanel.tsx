import { Eyebrow } from '@/components/page/Eyebrow';
import { cn } from '@/lib/utils';
import type { ChangelogEntry } from '@/app/(app)/dizajn/mock';
import type { BadgeStyle } from '@/components/library/options/changelog';
import { NewBadge } from '@/components/library/options/changelog/NewBadge';
import { HideTagsSwitch } from '@/components/library/options/changelog/HideTagsSwitch';

export interface ChangelogPanelProps {
  entries: ChangelogEntry[];
  newIds: ReadonlySet<string>;
  badge: BadgeStyle;
  hideTags: boolean;
  onHideTagsChange: (hide: boolean) => void;
  onMarkAllRead: () => void;
  className?: string;
}

/** Presentational only: the Top bar button's popover. Same entries as the
 *  full page, one summary line each instead of bullets, with Mark all as
 *  read in the header and the persistent switch in the footer. */
export function ChangelogPanel({ entries, newIds, badge, hideTags, onHideTagsChange, onMarkAllRead, className }: ChangelogPanelProps) {
  return (
    <div
      role="dialog"
      aria-label="What's new"
      data-testid="changelog-panel"
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-soft',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="font-semibold">What&apos;s new</div>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={newIds.size === 0}
          className="text-xs font-medium text-ember transition-colors hover:text-ember-soft disabled:text-muted-foreground disabled:opacity-60"
        >
          Mark all as read
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.map((e) => (
          <div key={e.id} data-testid="changelog-entry" className="rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/40">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow className="text-[10px]">{e.date}</Eyebrow>
              {newIds.has(e.id) && <NewBadge variant={badge} />}
            </div>
            <div className="mt-1 text-sm font-semibold">{e.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{e.summary}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-3">
        <HideTagsSwitch checked={hideTags} onCheckedChange={onHideTagsChange} className="justify-between" />
      </div>
    </div>
  );
}
