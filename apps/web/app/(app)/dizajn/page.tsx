'use client';

import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';
import { BarSpacingSection } from '@/components/library/options/barspacing/BarSpacingSection';
import { BAR_SPACING_RECOMMENDED_REASON } from '@/components/library/options/barspacing';

/** /dizajn: only the question open right now. The full gallery of past
 *  picks and candidates lives at /dizajn/sve. Mock data only; no link in
 *  the app points here. */
export default function DizajnPage() {
  return (
    <div>
      <PageTitle className="mb-cluster">Phone player: buttons further left</PageTitle>
      <p className="text-meta mb-stack">
        Aligned is in the real bar now. These only change how far left play and next sit (and where
        the seek line ends); everything else stays. {BAR_SPACING_RECOMMENDED_REASON}
      </p>
      <BarSpacingSection />
      <p className="text-meta mt-section">
        Everything else that used to be here:{' '}
        <Link href="/dizajn/sve" className="text-foreground underline">
          the full gallery
        </Link>
        .
      </p>
    </div>
  );
}
