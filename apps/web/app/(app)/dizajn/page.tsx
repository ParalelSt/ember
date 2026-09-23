'use client';

import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';

/** /dizajn: only the question open right now, and right now there is none.
 *  The last question, the search bar's missing bottom gap on desktop, was
 *  answered with Gap with a fade and it ships. The full gallery of past
 *  picks and candidates lives at /dizajn/sve. No link in the app points
 *  here. */
export default function DizajnPage() {
  return (
    <div>
      <PageTitle className="mb-cluster">Design</PageTitle>
      <p className="text-meta">
        Nothing to pick right now. The last question, the desktop search pill running its bottom
        edge into a scrolled page&apos;s content, was answered with a gap and a fade under it, and it
        ships. Everything older:{' '}
        <Link href="/dizajn/sve" className="text-foreground underline">
          the full gallery
        </Link>
        .
      </p>
    </div>
  );
}
