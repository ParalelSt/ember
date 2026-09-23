'use client';

import { Avatar } from '@/components/primitives/Avatar';
import { EmptyState } from '@/components/page/EmptyState';
import type { PrankPerson } from '@/lib/pranks/types';
import { cn } from '@/lib/utils';

/** The Control room's left column: everybody, whoever is listening first,
 *  each with what they play in plain words (never an id). Picking one fills
 *  in the composer. */
export function PeopleList({
  people,
  loading,
  selectedId,
  onSelect,
}: {
  people: PrankPerson[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) return <EmptyState>Loading…</EmptyState>;
  if (people.length === 0) return <EmptyState>Nobody here yet.</EmptyState>;
  return (
    <ul className="flex flex-col gap-inset" aria-label="People">
      {people.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            aria-pressed={selectedId === p.id}
            aria-label={`Pick ${p.name}`}
            onClick={() => onSelect(p.id)}
            className={cn(
              'flex w-full items-center gap-row rounded-lg px-row py-cluster text-left transition-colors',
              selectedId === p.id ? 'bg-card' : 'hover:bg-card/60',
            )}
          >
            <Avatar src={p.avatarUrl} name={p.name} className="size-8 shrink-0 bg-ember text-xs text-white" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-cluster">
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', p.listening ? 'bg-ember' : 'bg-muted-foreground/40')}
                />
                <span className="truncate text-row-title">{p.name}</span>
              </span>
              <span className="block truncate text-row-sub" data-testid="presence-line">
                {p.line}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
