'use client';

import { useSearchParams } from 'next/navigation';
import { ChangelogPage, clampPage } from '@/components/changelog/ChangelogPage';
import { useChangelog } from '@/hooks/useChangelog';
import dynamic from 'next/dynamic';
import { uiSwitch } from '@/components/providers/uiSwitch';

/** "What's new": the changelog, newest first, ten entries a page (?page=2).
 *  Opening the page does not clear the New tags; opening an entry (its own
 *  page) clears that entry's tag and Mark all as read clears them all
 *  (docs/changelog-system.md section 4). */
function NewWhatsNewPage() {
  const { entries, newIds, hideNew, setHideNew, markAllRead } = useChangelog();
  const page = clampPage(useSearchParams()?.get('page'), entries.length);
  return (
    <ChangelogPage
      entries={entries}
      newIds={newIds}
      page={page}
      hideTags={hideNew}
      onHideTagsChange={(hide) => void setHideNew(hide)}
      onMarkAllRead={() => void markAllRead()}
    />
  );
}

/** The Classic look's page (RULES.md "Classic look"), loaded only on a
 *  device that chose it. */
const LegacyWhatsNewPage = dynamic(() => import('@legacy/app/whats-new/page'));

export default uiSwitch(NewWhatsNewPage, LegacyWhatsNewPage);
