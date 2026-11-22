'use client';

import { useState } from 'react';
import { RowShelf } from '@/components/page/RowShelf';
import { CollectionCard } from '@/components/library/CollectionCard';
import type { NewReleaseItem, NewReleaseKind } from '@/lib/newReleasesView';
import { cn } from '@/lib/utils';

const TITLE = 'New releases';

const KIND_LABEL: Record<NewReleaseKind, string> = { album: 'Album', ep: 'EP', single: 'Single' };

type Group = 'all' | 'liked' | 'similar';

const GROUPS: { id: Group; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'liked', label: 'Your artists' },
  { id: 'similar', label: 'Similar' },
];

/** Presentational only: Home's "New releases" row. Album tiles, your liked
 *  artists' releases first (the list arrives in that order), each linking to
 *  its album. Renders nothing for an empty list. The All / Your artists /
 *  Similar switch shows only when both groups have something, starts on All
 *  and is not remembered. */
export function NewReleasesRow({ releases, isDesktop = false }: { releases: readonly NewReleaseItem[]; isDesktop?: boolean }) {
  const [group, setGroup] = useState<Group>('all');
  if (releases.length === 0) return null;

  const hasLiked = releases.some((r) => r.from === 'liked');
  const hasSimilar = releases.some((r) => r.from === 'similar');
  const both = hasLiked && hasSimilar;
  const active: Group = both ? group : 'all';
  const shown = active === 'all' ? releases : releases.filter((r) => r.from === active);

  const action = both ? (
    <div role="group" aria-label="Show releases from" className="flex items-center gap-cluster">
      {GROUPS.map((g) => {
        const on = g.id === active;
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={on}
            onClick={() => setGroup(g.id)}
            className={cn(
              'min-h-10 shrink-0 whitespace-nowrap rounded-full px-block text-[13px] font-semibold transition-colors',
              on ? 'bg-ember text-ember-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {g.label}
          </button>
        );
      })}
    </div>
  ) : undefined;

  return (
    // Home's fitted rows show one line of tiles; the rowKey is how "Show all"
    // reaches the rest.
    <RowShelf title={TITLE} variant={isDesktop ? 'desktop' : 'phone'} limit={Infinity} rowKey="releases" action={action}>
      {shown.map((r) => (
        <CollectionCard
          key={r.browseId}
          variant={isDesktop ? 'tile-lg' : 'tile'}
          title={r.title}
          subtitle={`${KIND_LABEL[r.kind]} · ${r.artist}`}
          href={`/album/${encodeURIComponent(r.browseId)}`}
          cover={{ src: r.artworkUrl, icon: null, fallback: 'card' }}
        />
      ))}
    </RowShelf>
  );
}
