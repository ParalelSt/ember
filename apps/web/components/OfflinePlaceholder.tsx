'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

interface Props {
  href?: string;
  label?: string;
}

/** Shown on every route except /library and /playlist/<id> when the user
 *  is offline. Library is special-cased to show their downloaded pins. */
export function OfflinePlaceholder({ href = '/library', label = 'Go to Downloaded' }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-lg font-semibold">You&apos;re offline</div>
      <div className="mt-1 text-sm text-muted-foreground max-w-sm">
        Only your downloaded playlists are available right now.
      </div>
      <Link href={href} className={`${buttonVariants({})} mt-6`}>
        {label}
      </Link>
    </div>
  );
}
