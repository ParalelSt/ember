'use client';

import { useState } from 'react';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { SearchGapFrame } from '@/components/library/options/searchgap/SearchGapFrame';
import {
  SEARCHGAP_RECOMMENDED,
  SEARCHGAP_RECOMMENDED_REASON,
  type SearchGapCandidate,
} from '@/components/library/options/searchgap';

const SMALL = { width: 1280, height: 800, label: '1280px' };
const LARGE = { width: 1920, height: 1000, label: '1920px' };

export interface SearchGapSectionProps {
  candidate: SearchGapCandidate;
}

/** One candidate, drawn at both required desktop widths side by side
 *  (phone is skipped: the search bar is not in flow there, so this fix
 *  does not apply). Each frame is a fixed-size box at the device's real
 *  pixel width, scaled down to whatever the column has, same convention
 *  ChangelogSection and ThemesSection use. Two separate useState calls
 *  (not one indexed into an array) so each ScaledFrame's onScale keeps a
 *  stable setter identity: an inline closure that rebuilds a new array
 *  every render retriggers ScaledFrame's own onScale effect every render
 *  too, which was an infinite update loop here before this fix. */
export function SearchGapSection({ candidate }: SearchGapSectionProps) {
  const [smallScale, setSmallScale] = useState(1);
  const [largeScale, setLargeScale] = useState(1);
  const recommended = candidate.id === SEARCHGAP_RECOMMENDED;

  return (
    <div
      data-testid="searchgap-section"
      data-candidate={candidate.id}
      className="mb-section"
    >
      <div className="mb-cluster flex items-center gap-cluster">
        <h3 className="text-section-title">{candidate.name}</h3>
        {recommended && (
          <span
            data-testid="searchgap-recommended-badge"
            className="rounded-full bg-ember px-inset py-inset text-xs font-semibold uppercase tracking-wide text-white"
          >
            Recommended
          </span>
        )}
      </div>
      <p className="text-meta mb-block">{candidate.description}</p>
      {recommended && (
        <p data-testid="searchgap-recommended-reason" className="text-meta mb-block">
          <span className="font-semibold text-foreground">Why: </span>
          {SEARCHGAP_RECOMMENDED_REASON}
        </p>
      )}
      <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
        {[
          { ...SMALL, scale: smallScale, onScale: setSmallScale },
          { ...LARGE, scale: largeScale, onScale: setLargeScale },
        ].map(({ width, height, label, scale, onScale }) => (
          <div key={width} className="min-w-0 flex-1">
            <div className="mb-cluster text-eyebrow">
              {label} <span className="normal-case tracking-normal">({Math.round(scale * 100)}%)</span>
            </div>
            <ScaledFrame width={width} height={height} onScale={onScale}>
              <SearchGapFrame candidate={candidate} />
            </ScaledFrame>
          </div>
        ))}
      </div>
    </div>
  );
}
