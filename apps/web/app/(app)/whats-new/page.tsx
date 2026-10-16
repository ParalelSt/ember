'use client';

import { ChangelogPage } from '@/components/changelog/ChangelogPage';
import { useChangelog } from '@/hooks/useChangelog';

/** "What's new": every changelog entry, newest first. Opening the page does
 *  not clear the New tags; opening an entry (its own page) clears that entry's tag and
 *  Mark all as read clears them all (docs/changelog-system.md section 4). */
export default function WhatsNewPage() {
  const { entries, newIds, hideNew, setHideNew, markAllRead } = useChangelog();
  return (
    <ChangelogPage
      entries={entries}
      newIds={newIds}
      hideTags={hideNew}
      onHideTagsChange={(hide) => void setHideNew(hide)}
      onMarkAllRead={() => void markAllRead()}
    />
  );
}
