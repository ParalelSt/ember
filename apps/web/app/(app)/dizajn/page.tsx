'use client';

import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';
import { SEARCHGAP_OPTIONS } from '@/components/library/options/searchgap';
import { SearchGapSection } from '@/components/library/options/searchgap/SearchGapSection';

/** /dizajn: the open question. A small desktop layout fix (owner's report:
 *  "the pc navbar is missing a portion at the bottom, could be solved by
 *  adding some padding but make sure to show me how it'd look"): the
 *  desktop search pill's wrapper (SearchOverlayContainer, in
 *  app/(app)/layout.tsx) has no bottom padding, so a scrolled page's
 *  content runs up against its bottom edge. Four candidates for that one
 *  wrapper, all shown at once so the owner can pick before it is built.
 *  Not built yet, no link points here. Everything older:
 *  /dizajn/sve. */
export default function DizajnPage() {
  return (
    <div>
      <PageTitle className="mb-cluster">Design</PageTitle>
      <p className="text-meta mb-stack">
        Search bar bottom gap: on desktop the search pill has no padding under it, so a scrolled
        page&apos;s content runs up against its bottom edge. Not built yet, no link points here.
        Everything older:{' '}
        <Link href="/dizajn/sve" className="text-foreground underline">
          the full gallery
        </Link>
        .
      </p>

      <section>
        <h2 className="text-section-title mb-block">Search bar bottom gap</h2>
        <p className="text-meta mb-section">
          Desktop only (1280px and 1920px): the phone search sheet is not in flow, so it has no
          bottom-edge problem to fix. Every frame below shows the page already scrolled, so the
          gap under the pill is exactly what it would look like once a real page runs past its own
          top padding.
        </p>

        {SEARCHGAP_OPTIONS.map((candidate) => (
          <SearchGapSection key={candidate.id} candidate={candidate} />
        ))}
      </section>
    </div>
  );
}
