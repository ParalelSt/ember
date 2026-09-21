'use client';

import Link from 'next/link';
import { PageTitle } from '@/components/page/PageTitle';
import { BarColorsSection } from '@/components/library/options/barcolors/BarColorsSection';
import { BAR_COLOR_RECOMMENDED_REASON } from '@/components/library/options/barcolors';

/** /dizajn: only the question open right now. The full gallery of past
 *  picks and candidates lives at /dizajn/sve. Mock data only; no link in
 *  the app points here. */
export default function DizajnPage() {
  return (
    <div>
      <PageTitle className="mb-cluster">Phone player colours</PageTitle>
      <p className="text-meta mb-stack">
        Same bar, same layout, only the colours change. Right now the red ring on the seek dot is the
        only colour in the strip. {BAR_COLOR_RECOMMENDED_REASON}
      </p>
      <BarColorsSection />
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
