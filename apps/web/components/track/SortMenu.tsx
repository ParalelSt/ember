'use client';

import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { ArrowDownIcon, ArrowUpIcon, SortIcon } from '@/components/icons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { SORT_KEYS, nextSort, sortLabel, type SortKey, type SortState } from '@/lib/playlistCopy';
import { cn } from '@/lib/utils';

const TRIGGER =
  'inline-flex h-10 shrink-0 items-center gap-inset whitespace-nowrap rounded-full px-row text-sm font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground';

/** Presentational only: "Date added ↓" at the right end of the action bar,
 *  and the owner's "simple list" behind it: Title, Artist, Date added,
 *  Duration. The one in use is highlighted with an arrow for its direction;
 *  picking it again flips the direction, picking another starts that one at
 *  its natural direction (lib/playlistCopy nextSort). A dropdown on desktop,
 *  a sheet from the bottom on a phone, like every other menu. */
export function SortMenu({ sort, onChange }: { sort: SortState; onChange: (sort: SortState) => void }) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const current = SORT_KEYS.find((k) => k.key === sort.key) ?? SORT_KEYS[2];
  const Arrow = sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  const pick = (key: SortKey) => onChange(nextSort(sort, key));
  const label = `Sort: ${sortLabel(sort)}`;
  const face = (
    <>
      <SortIcon className="size-4" />
      {current.label}
      <Arrow className="size-3.5" />
    </>
  );
  // Read out with the item: "Title, A to Z" on the one in use.
  const direction = (key: SortKey) => {
    if (key !== sort.key) return null;
    return <span className="sr-only">, {sort.dir === 'asc' ? current.asc : current.desc}</span>;
  };

  if (!isDesktop) {
    return (
      <>
        <button
          type="button"
          data-testid="sort-button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={TRIGGER}
          onClick={() => setOpen(true)}
        >
          {face}
        </button>
        <ActionSheet open={open} onOpenChange={setOpen} title="Sort by">
          <div data-testid="sort-menu" className="flex flex-col">
            {SORT_KEYS.map((k) => {
              const on = k.key === sort.key;
              return (
                <ActionSheetItem
                  key={k.key}
                  testId={`sort-${k.key}`}
                  tone={on ? 'ember' : undefined}
                  trailing={on ? <Arrow className="size-4 shrink-0" /> : undefined}
                  onSelect={() => {
                    setOpen(false);
                    pick(k.key);
                  }}
                >
                  {k.label}
                  {direction(k.key)}
                </ActionSheetItem>
              );
            })}
          </div>
        </ActionSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid="sort-button" aria-label={label} className={TRIGGER}>
        {face}
      </DropdownMenuTrigger>
      <DropdownMenuContent data-testid="sort-menu" align="end" className="min-w-48">
        {SORT_KEYS.map((k) => {
          const on = k.key === sort.key;
          return (
            <DropdownMenuItem
              key={k.key}
              data-testid={`sort-${k.key}`}
              data-active={on || undefined}
              onClick={() => pick(k.key)}
              className={cn('justify-between', on && 'bg-accent/60 font-semibold text-ember')}
            >
              <span>
                {k.label}
                {direction(k.key)}
              </span>
              {on && <Arrow className="size-4 text-ember" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
