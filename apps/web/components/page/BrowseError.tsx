'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/page/EmptyState';

/** An artist or album page whose fetch failed. Only a 404 (or an id that is
 *  not one, 400) means it does not exist; anything else (YouTube Music down,
 *  a timeout, too many requests) is passing, so it says what the server said
 *  and offers another go instead of a "not found" that sends people away. */
export function BrowseError({
  error,
  kind,
  onRetry,
}: {
  error: unknown;
  kind: 'Artist' | 'Album';
  onRetry: () => void;
}) {
  const status = (error as { status?: number } | null)?.status;
  const missing = status === 404 || status === 400;
  const message = (error as { message?: string } | null)?.message;
  return (
    <EmptyState>
      {missing ? `${kind} not found.` : message || `Couldn't load this ${kind.toLowerCase()} right now.`}
      <br />
      {!missing && (
        <>
          <Button variant="ghost" className="mt-2 text-ember" onClick={onRetry}>Try again</Button>
          <br />
        </>
      )}
      <Link href="/" className="text-ember hover:underline">Home</Link>
    </EmptyState>
  );
}
