'use client';

import { use, useEffect } from 'react';
import { ChangelogEntryPage } from '@/components/changelog/ChangelogEntryPage';
import { useChangelog } from '@/hooks/useChangelog';

/** One "What's new" entry. Opening it marks that entry read (clears its New
 *  pill); an unknown id shows a friendly empty state. */
export default function WhatsNewEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { entries, markRead, loaded } = useChangelog();
  const entry = entries.find((e) => e.id === id);

  useEffect(() => {
    if (entry && loaded) void markRead(entry.id);
  }, [entry, loaded, markRead]);

  return <ChangelogEntryPage entry={entry} />;
}
