'use client';

import { useEffect, useRef } from 'react';
import { CloseIcon, SearchIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** The "Search in this list" box, in the main Search page's input style.
 *  Escape clears it and calls `onEscape` (variant a closes the box). */
export function ListSearchBox({
  value,
  onChange,
  onEscape,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onEscape?: () => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div data-testid="list-search" className="relative max-w-xl">
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onChange('');
            onEscape?.();
          }
        }}
        placeholder="Search in this list"
        aria-label="Search in this list"
        className={cn('h-12 rounded-full border-0 bg-card pl-11', value ? 'pr-12' : 'pr-4')}
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear list search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
          className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full active:!-translate-y-1/2"
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
