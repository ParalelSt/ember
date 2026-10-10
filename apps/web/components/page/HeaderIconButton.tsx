import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** The library header's icon-only action: a 44px squircle (radius 32% of the
 *  size) on a soft secondary fill, a touch lighter on hover, the ember accent
 *  while pressed. Pass the icon as children and an aria-label. */
export const HEADER_ICON_BUTTON =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-[32%] bg-secondary text-foreground transition-colors outline-none hover:bg-accent active:bg-ember/20 active:text-ember focus-visible:ring-3 focus-visible:ring-ring/50';

export function HeaderIconButton({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return <button type={type} data-shape="squircle" className={cn(HEADER_ICON_BUTTON, className)} {...props} />;
}
