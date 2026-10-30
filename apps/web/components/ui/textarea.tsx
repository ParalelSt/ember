import * as React from 'react';
import { cn } from '@/lib/utils';

/** The "Filled" text box, matching Input's chrome (see input.tsx). */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full min-w-0 rounded-(--radius-field) bg-input px-3.5 py-[11px] text-base transition-[background-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ember disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive md:text-sm resize-y',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
