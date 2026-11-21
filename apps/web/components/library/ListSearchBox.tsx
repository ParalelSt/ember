'use client';

import { useEffect, useRef } from 'react';
import { CloseIcon, SearchIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** The "Search in this list" box, in the main Search page's input style.
 *  Escape clears it and calls `onEscape` (the phone box closes). */
export function ListSearchBox({
  value,
  onChange,
  onEscape,
  autoFocus,
  variant = 'underline',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onEscape?: () => void;
  autoFocus?: boolean;
  /** underline: phone, flat. soft: desktop, filled rectangle. */
  variant?: 'underline' | 'soft';
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div
      data-testid="list-search"
      data-variant={variant}
      className={cn('group relative', variant === 'underline' && 'border-b border-foreground/15 focus-within:border-ember', className)}
    >
      <SearchIcon
        className={cn(
          'pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground',
          variant === 'underline' ? 'left-0' : 'left-3',
        )}
      />
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
        className={cn(
          'h-10 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
          variant === 'underline'
            ? 'rounded-none bg-transparent pl-7 text-base md:text-sm'
            : 'rounded-md bg-foreground/5 pl-9 text-sm focus-visible:bg-foreground/10',
          value ? 'pr-10' : 'pr-3',
        )}
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
          className="absolute right-0 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full active:!-translate-y-1/2"
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
