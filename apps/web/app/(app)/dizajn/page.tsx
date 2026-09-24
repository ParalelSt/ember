'use client';

import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';
import { TOPBAR_OPTIONS } from '@/components/library/options/topbar';
import { TopBarSection } from '@/components/library/options/topbar/TopBarSection';

/** /dizajn: the open question. The desktop top bar (the search pill area in
 *  app/(app)/layout.tsx): the scrollbar starts under the bar instead of at
 *  the top of the window, and scrolled content runs right up to the pill.
 *  A padded gap was rejected (it pushed the page and the scrollbar down), so
 *  every candidate keeps the heading where it is today. Not built yet, no
 *  link points here. Everything older: /dizajn/sve. */
export default function DizajnPage() {
  return (
    <div>
      <PageTitle className="mb-cluster">Design</PageTitle>
      <p className="text-meta mb-stack">
        Desktop top bar: where the scrollbar starts, and a clean band under the search pill once
        the page scrolls, without pushing the page down. Not built yet, no link points here.
        Everything older:{' '}
        <Link href="/dizajn/sve" className="text-foreground underline">
          the full gallery
        </Link>
        .
      </p>

      <section>
        <h2 className="text-section-title mb-block">Desktop top bar</h2>
        <p className="text-meta mb-section">
          Each candidate at 1280px and 1920px, scrolled to the top and scrolled 300px, plus the
          scrolled state under the Midnight and Mono themes. The dashed line and label mark where
          the scrollbar starts. The red bar under the pill measures the gap: at the top, pill to
          heading (32px in every candidate, as today); scrolled, the clear band content never
          shows in.
        </p>

        {TOPBAR_OPTIONS.map((candidate) => (
          <TopBarSection key={candidate.id} candidate={candidate} />
        ))}
      </section>
    </div>
  );
}
