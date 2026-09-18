import { Button } from '@/components/ui/button';
import { CheckIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { Eyebrow } from '@/components/page/Eyebrow';
import type { ChangelogEntry } from '@/lib/changelog';
import { NewBadge } from '@/components/changelog/NewBadge';
import { HideTagsSwitch } from '@/components/changelog/HideTagsSwitch';

export interface ChangelogPageProps {
  entries: ChangelogEntry[];
  /** Ids that currently carry a New tag (already empty when tags are hidden
   *  or everything was marked read). */
  newIds: ReadonlySet<string>;
  hideTags: boolean;
  onHideTagsChange: (hide: boolean) => void;
  onMarkAllRead: () => void;
}

const SCOPE_LABEL: Record<NonNullable<ChangelogEntry['scope']>, string> = {
  desktop: 'Desktop app',
  android: 'Android app',
};

/** Presentational only: the full "What's new" page, shaped like the settings
 *  pages (PageTitle, then rounded-2xl bg-card cards as on Settings > Help).
 *  Mark all as read and the persistent switch sit in the header so they are
 *  reachable before the first card. */
export function ChangelogPage({ entries, newIds, hideTags, onHideTagsChange, onMarkAllRead }: ChangelogPageProps) {
  return (
    <div data-testid="changelog-page" className="max-w-2xl">
      <PageTitle className="mb-2">What&apos;s new</PageTitle>
      <p className="text-meta">Updates to Ember, newest first.</p>

      <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" onClick={onMarkAllRead} disabled={newIds.size === 0}>
          <CheckIcon className="h-4 w-4" />
          Mark all as read
        </Button>
        <HideTagsSwitch checked={hideTags} onCheckedChange={onHideTagsChange} />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {entries.map((e) => (
          <article key={e.id} data-testid="changelog-entry" data-entry-id={e.id} className="rounded-2xl bg-card p-6 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>
                {[e.version, e.date, e.scope && SCOPE_LABEL[e.scope]].filter(Boolean).join(' · ')}
              </Eyebrow>
              {newIds.has(e.id) && <NewBadge />}
            </div>
            <div className="mt-2 font-semibold">{e.title}</div>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground marker:text-muted-foreground/50">
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
