'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@/components/icons';
import { leavePage } from '@/lib/inAppHistory';
import { cn } from '@/lib/utils';

/** The one look every back control shares (the owner's "Round, in the top
 *  bar" pick): a filled 36px circle on the soft secondary fill with the
 *  bold arrow in the foreground colour, a touch lighter on hover. The
 *  `after:` box grows the hit area to 44px, phone sized, without changing
 *  what is drawn. Restyle back controls here, not at call sites. */
export const BACK_BUTTON_CLASS =
  'relative inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 after:absolute after:-inset-1';

type BackButtonProps = {
  /** What it goes back to, read by screen readers ("Back to Admin"). */
  label?: string;
  className?: string;
  testId?: string;
} & (
  | { href: string; onClick?: never; fallbackHref?: never }
  | { href?: never; onClick: () => void; fallbackHref?: never }
  /** Neither: Back through the app's own history, or `fallbackHref` (home
   *  by default) when the page before was not Ember's. */
  | { href?: never; onClick?: never; fallbackHref?: string }
);

const ICON = <ArrowLeftIcon className="size-5" />;

/** Shared back control: a link when given `href`, a button running
 *  `onClick` when given that, and otherwise a button that goes back the way
 *  the listener came (lib/inAppHistory), falling back to `fallbackHref`. */
export function BackButton({ href, onClick, fallbackHref, label = 'Back', className, testId }: BackButtonProps) {
  const cls = cn(BACK_BUTTON_CLASS, className);
  if (href !== undefined) {
    return (
      <Link href={href} aria-label={label} data-slot="back-button" data-testid={testId} className={cls}>
        {ICON}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} data-slot="back-button" data-testid={testId} className={cls}>
        {ICON}
      </button>
    );
  }
  return <HistoryBackButton fallbackHref={fallbackHref ?? '/'} label={label} className={cls} testId={testId} />;
}

function HistoryBackButton({ fallbackHref, label, className, testId }: { fallbackHref: string; label: string; className: string; testId?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => leavePage(router, fallbackHref)}
      aria-label={label}
      data-slot="back-button"
      data-testid={testId}
      className={className}
    >
      {ICON}
    </button>
  );
}
