'use client';

import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';

/** /dizajn: only the question open right now, and right now there is none.
 *  The full gallery of past picks and candidates lives at /dizajn/sve. No
 *  link in the app points here. */
export default function DizajnPage() {
  return (
    <div>
      <PageTitle className="mb-cluster">Design</PageTitle>
      <p className="text-meta">
        Nothing to pick right now. The last question, how to ask a person where their music is
        without asking them to know what a CSV is, was answered with &ldquo;What do you
        have?&rdquo;, and it ships. Everything older:{' '}
        <Link href="/dizajn/sve" className="text-foreground underline">
          the full gallery
        </Link>
        .
      </p>
    </div>
  );
}
