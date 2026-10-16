import Link from 'next/link';
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

export const SCOPE_LABEL: Record<NonNullable<ChangelogEntry['scope']>, string> = {
  desktop: 'Desktop app',
  android: 'Android app',
};

export const entryHref = (id: string) => `/whats-new/${encodeURIComponent(id)}`;

/** Presentational only: the "What's new" list. Compact cards (version and
 *  date, title, one-line summary); each whole card links to its own page,
 *  which marks the entry read. Mark all as read sits on the title row and
 *  the persistent switch right under it. */
export function ChangelogPage({ entries, newIds, hideTags, onHideTagsChange, onMarkAllRead }: ChangelogPageProps) {
  return (
    <div data-testid="changelog-page" className="max-w-xl">
      <div className="flex items-baseline justify-between gap-block">
        <PageTitle>What&apos;s new</PageTitle>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={newIds.size === 0}
          className="shrink-0 text-sm font-medium text-ember transition-opacity disabled:cursor-default disabled:opacity-40"
        >
          Mark all as read
        </button>
      </div>
      <HideTagsSwitch checked={hideTags} onCheckedChange={onHideTagsChange} className="mt-row" />

      <div className="mt-stack flex flex-col gap-row">
        {entries.map((e) => (
          <Link
            key={e.id}
            href={entryHref(e.id)}
            data-testid="changelog-entry"
            data-entry-id={e.id}
            className="block rounded-2xl bg-card p-block shadow-soft transition-colors hover:bg-card/80"
          >
            <div className="flex items-center justify-between gap-row">
              <Eyebrow>{[e.version, e.date].join(' · ')}</Eyebrow>
              {newIds.has(e.id) && <NewBadge />}
            </div>
            <div className="mt-inset truncate font-semibold">{e.title}</div>
            <p className="truncate text-sm text-muted-foreground">{e.summary}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
