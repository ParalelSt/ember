import Link from 'next/link';
import { ArrowLeftIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** The one look every back control shares. Taken from the What's new back
 *  arrow (ChangelogEntryPage): a round, phone-sized hit box, the bold arrow,
 *  muted until hovered. Restyle back controls here, not at call sites. */
export const BACK_BUTTON_CLASS =
  'inline-flex size-hit shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground';

type BackButtonProps = {
  /** What it goes back to, read by screen readers ("Back to Admin"). */
  label?: string;
  className?: string;
} & ({ href: string; onClick?: never } | { href?: never; onClick: () => void });

/** Shared back control: a link when given `href`, a button when given
 *  `onClick`. */
export function BackButton({ href, onClick, label = 'Back', className }: BackButtonProps) {
  const icon = <ArrowLeftIcon className="size-5" />;
  const cls = cn(BACK_BUTTON_CLASS, className);
  if (href !== undefined) {
    return (
      <Link href={href} aria-label={label} data-slot="back-button" className={cls}>
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} data-slot="back-button" className={cls}>
      {icon}
    </button>
  );
}
