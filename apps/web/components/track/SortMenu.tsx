'use client';

import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ArrowDownIcon, ArrowUpIcon, SortIcon } from '@/components/icons';
import { SORT_KEYS, sortLabel, type SortState } from '@/lib/playlistCopy';
import { cn } from '@/lib/utils';

/** Presentational only: "Sort: Date added ↑", and the choices it opens:
 *  title, artist, date added and duration, each both ways. A popover under
 *  the button on every size (it fits a phone: 20rem, clamped to the
 *  screen). */
export function SortMenu({ sort, onChange }: { sort: SortState; onChange: (sort: SortState) => void }) {
  const [open, setOpen] = useState(false);
  const key = SORT_KEYS.find((k) => k.key === sort.key) ?? SORT_KEYS[2];
  const Arrow = sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        data-testid="sort-button"
        aria-label={`Sort: ${sortLabel(sort)}`}
        className="inline-flex h-10 shrink-0 items-center gap-inset whitespace-nowrap rounded-full px-row text-sm font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground"
      >
        <SortIcon className="size-4" />
        {key.label}
        <Arrow className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={16} className="isolate z-50">
          <Popover.Popup
            data-testid="sort-menu"
            aria-label="Sort by"
            className="w-80 max-w-(--available-width) rounded-xl border border-border bg-popover p-cluster text-popover-foreground shadow-soft outline-none"
          >
            <div role="group" aria-label="Sort by" className="flex flex-col gap-inset">
              {SORT_KEYS.map((k) => {
                const current = sort.key === k.key;
                return (
                  <div key={k.key} className="flex items-center justify-between gap-row rounded-md px-cluster py-inset">
                    <span className={cn('text-sm', current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{k.label}</span>
                    <div className="flex gap-inset">
                      {(['asc', 'desc'] as const).map((dir) => {
                        const on = current && sort.dir === dir;
                        return (
                          <button
                            key={dir}
                            type="button"
                            aria-pressed={on}
                            aria-label={`${k.label}, ${dir === 'asc' ? k.asc : k.desc}`}
                            onClick={() => {
                              onChange({ key: k.key, dir });
                              setOpen(false);
                            }}
                            className={cn(
                              'whitespace-nowrap rounded-full border px-cluster py-inset text-xs font-medium transition-colors',
                              on ? 'border-ember bg-ember text-ember-foreground' : 'border-border text-muted-foreground hover:bg-card',
                            )}
                          >
                            {dir === 'asc' ? k.asc : k.desc}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
