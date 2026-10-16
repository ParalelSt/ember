import Link from 'next/link';
import { ChevronLeftIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { Eyebrow } from '@/components/page/Eyebrow';
import type { ChangelogEntry } from '@/lib/changelog';
import { SCOPE_LABEL } from '@/components/changelog/ChangelogPage';

/** Presentational only: one full changelog entry on its own page, with a back
 *  arrow to the list. `entry` is undefined for an unknown id. */
export function ChangelogEntryPage({ entry }: { entry: ChangelogEntry | undefined }) {
  return (
    <div data-testid="changelog-entry-page" className="max-w-2xl">
      <Link
        href="/whats-new"
        aria-label="Back to What's new"
        data-testid="changelog-back"
        className="mb-block inline-flex size-hit items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground md:size-8"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </Link>
      {entry ? (
        <>
          <Eyebrow>{[entry.version, entry.date, entry.scope && SCOPE_LABEL[entry.scope]].filter(Boolean).join(' · ')}</Eyebrow>
          <PageTitle className="mt-inset">{entry.title}</PageTitle>
          <ul className="mt-block flex list-disc flex-col gap-cluster pl-4 text-muted-foreground marker:text-muted-foreground/50">
            {entry.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      ) : (
        <p data-testid="changelog-missing" className="text-muted-foreground">
          That update could not be found. It may be from an older version.
        </p>
      )}
    </div>
  );
}
