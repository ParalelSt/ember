import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** One button or one link: `href` makes it a link, `onClick` a button. */
export type EmptyStateAction = { label: string } & ({ href: string } | { onClick: () => void });

export interface EmptyStateProps {
  /** The sentence (or, on its own, the whole plain message). */
  children?: ReactNode;
  className?: string;
  /** A glyph for the soft round badge on top. */
  icon?: ReactNode;
  /** One line, above the sentence. */
  title?: string;
  /** The heading level: h1 where this stands in for a whole page. */
  titleAs?: 'h1' | 'h2';
  /** The next step, an ember button. */
  action?: EmptyStateAction;
  /** A quieter second button beside it. */
  secondaryAction?: EmptyStateAction;
}

const BASE = 'text-muted-foreground py-12 text-center';
const ACTION_SHAPE = 'h-10 rounded-full px-block';

function ActionControl({ action, variant }: { action: EmptyStateAction; variant: 'ember' | 'secondary' }) {
  if ('href' in action) {
    return (
      <Link href={action.href} className={buttonVariants({ variant, className: ACTION_SHAPE })}>
        {action.label}
      </Link>
    );
  }
  return (
    <Button variant={variant} onClick={action.onClick} className={ACTION_SHAPE}>
      {action.label}
    </Button>
  );
}

/** Presentational only: the centred block every page uses between fetches
 *  or when a list has nothing in it. Plain, it is a muted line ("Loading…",
 *  "not found"), and `className` carries the few variants (a smaller type
 *  size, a different colour). With `icon`, `title` or `action` it is the
 *  owner's "Icon and a next step" look: a soft round icon, a one-line title,
 *  the sentence and the button. */
export function EmptyState({
  children,
  className,
  icon,
  title,
  titleAs: Title = 'h2',
  action,
  secondaryAction,
}: EmptyStateProps) {
  if (!icon && !title && !action) {
    return <div className={cn(BASE, className)}>{children}</div>;
  }
  return (
    <div className={cn(BASE, 'flex flex-col items-center', className)}>
      {icon && (
        <div
          data-testid="empty-icon"
          className="mb-block flex size-14 items-center justify-center rounded-full bg-card [&_svg]:size-6"
        >
          {icon}
        </div>
      )}
      {title && <Title className="w-full truncate text-base font-semibold text-foreground">{title}</Title>}
      {children && <p className={cn('max-w-sm text-sm', title && 'mt-inset')}>{children}</p>}
      {action && (
        <div className="mt-stack flex flex-wrap justify-center gap-cluster">
          <ActionControl action={action} variant="ember" />
          {secondaryAction && <ActionControl action={secondaryAction} variant="secondary" />}
        </div>
      )}
    </div>
  );
}
