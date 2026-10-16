'use client';

import { use, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChangelogEntryPage } from '@/components/changelog/ChangelogEntryPage';
import { useChangelog } from '@/hooks/useChangelog';

/** One "What's new" entry. Opening it marks that entry read (clears its New
 *  pill); an unknown id shows a friendly empty state. Moving to a neighbour
 *  replaces the URL so Back still returns to the list. */
export default function WhatsNewEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { entries, markRead, loaded } = useChangelog();
  const entry = entries.find((e) => e.id === id);

  useEffect(() => {
    if (entry && loaded) void markRead(entry.id);
  }, [entry, loaded, markRead]);

  const onGo = useCallback((to: string) => router.replace(`/whats-new/${to}`), [router]);
  const onGotIt = useCallback(() => {
    if (entry) void markRead(entry.id);
    router.push('/whats-new');
  }, [entry, markRead, router]);

  return <ChangelogEntryPage entry={entry} entries={entries} onGo={onGo} onGotIt={onGotIt} />;
}
