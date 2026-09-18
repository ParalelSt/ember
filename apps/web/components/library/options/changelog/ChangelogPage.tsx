import { Button } from '@/components/ui/button';
import { CheckIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { Eyebrow } from '@/components/page/Eyebrow';
import { cn } from '@/lib/utils';
import type { ChangelogEntry } from '@/app/(app)/dizajn/mock';
import type { BadgeStyle } from '@/components/library/options/changelog';
import { NewBadge } from '@/components/library/options/changelog/NewBadge';
import { HideTagsSwitch } from '@/components/library/options/changelog/HideTagsSwitch';

export interface ChangelogPageProps {
  entries: ChangelogEntry[];
  /** Ids that currently carry a New tag (already empty when tags are hidden
   *  or everything was marked read). */
  newIds: ReadonlySet<string>;
  badge: BadgeStyle;
  hideTags: boolean;
  onHideTagsChange: (hide: boolean) => void;
  onMarkAllRead: () => void;
  /** Resolves text-page-title to its phone size inside the 390px frame,
   *  where the viewport-keyed md: size would otherwise apply. */
  phone: boolean;
}

/** Presentational only: the full "What's new" page, shaped like the other
 *  settings pages (PageTitle, then rounded-2xl bg-card cards as on
 *  Settings > Help). Mark all as read and the persistent switch sit in the
 *  header so they are reachable before the first card. */
export function ChangelogPage({ entries, newIds, badge, hideTags, onHideTagsChange, onMarkAllRead, phone }: ChangelogPageProps) {
  return (
    <div data-testid="changelog-page" className="max-w-2xl">
      <PageTitle className={cn('mb-2', phone ? 'text-3xl!' : 'text-4xl!')}>What&apos;s new</PageTitle>
      <p className="text-meta">Updates to Ember, newest first.</p>

      <div className={cn('mt-stack flex gap-4', phone ? 'flex-col items-start' : 'flex-row items-center justify-between')}>
        <Button variant="outline" onClick={onMarkAllRead} disabled={newIds.size === 0}>
          <CheckIcon className="h-4 w-4" />
          Mark all as read
        </Button>
        <HideTagsSwitch checked={hideTags} onCheckedChange={onHideTagsChange} />
      </div>

      <div className="mt-stack flex flex-col gap-stack">
        {entries.map((e) => (
          <article key={e.id} data-testid="changelog-entry" className="rounded-2xl bg-card p-6 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>{e.date}</Eyebrow>
              {newIds.has(e.id) && <NewBadge variant={badge} />}
            </div>
            <div className="mt-cluster font-semibold">{e.title}</div>
            <ul className="mt-cluster flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground marker:text-muted-foreground/50">
              {e.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
