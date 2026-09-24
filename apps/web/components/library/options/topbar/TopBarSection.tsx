'use client';

import { useState } from 'react';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { TopBarFrame } from '@/components/library/options/topbar/TopBarFrame';
import {
  TOPBAR_RECOMMENDED,
  TOPBAR_RECOMMENDED_REASON,
  type TopBarCandidate,
} from '@/components/library/options/topbar';
import { themeStyle } from '@/lib/theme/css';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import type { PresetId } from '@/lib/theme/model';

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1000 },
];

/** How far the "scrolled" pictures are scrolled, px. */
export const TOPBAR_SCROLL = 300;

/** Themes the scrolled state is also drawn in (1280 only). */
const THEME_CHECKS: PresetId[] = ['midnight', 'mono'];

/** One scaled frame with its own label and its own scale state: one
 *  useState per frame keeps each ScaledFrame's onScale setter stable (a new
 *  closure every render loops its onScale effect). */
function Shot({
  candidate,
  width,
  height,
  scrollY,
  label,
  preset,
}: {
  candidate: TopBarCandidate;
  width: number;
  height: number;
  scrollY: number;
  label: string;
  preset?: PresetId;
}) {
  const [scale, setScale] = useState(1);
  return (
    <div
      data-testid="topbar-shot"
      data-candidate={candidate.id}
      data-width={width}
      data-scroll={scrollY}
      data-preset={preset ?? 'ember'}
      className="min-w-0 flex-1"
    >
      <div className="mb-cluster text-eyebrow">
        {label} <span className="normal-case tracking-normal">({Math.round(scale * 100)}%)</span>
      </div>
      <div style={preset ? themeStyle({ v: 1, preset }) : undefined}>
        <ScaledFrame width={width} height={height} onScale={setScale}>
          <TopBarFrame candidate={candidate} scrollY={scrollY} />
        </ScaledFrame>
      </div>
    </div>
  );
}

export interface TopBarSectionProps {
  candidate: TopBarCandidate;
}

/** One candidate: scrolled to top and scrolled 300px, each at 1280 and
 *  1920, then the scrolled state again under the Midnight and Mono presets. */
export function TopBarSection({ candidate }: TopBarSectionProps) {
  const recommended = candidate.id === TOPBAR_RECOMMENDED;
  const states = [
    { scrollY: 0, title: 'Scrolled to top' },
    { scrollY: TOPBAR_SCROLL, title: `Scrolled ${TOPBAR_SCROLL}px` },
  ];

  return (
    <div data-testid="topbar-section" data-candidate={candidate.id} className="mb-section">
      <div className="mb-cluster flex items-center gap-cluster">
        <h3 className="text-section-title">{candidate.name}</h3>
        {recommended && (
          <span
            data-testid="topbar-recommended-badge"
            className="rounded-full bg-ember px-cluster py-inset text-xs font-semibold uppercase tracking-wide text-ember-foreground"
          >
            Recommended
          </span>
        )}
      </div>
      <p className="text-meta mb-block">{candidate.description}</p>
      {recommended && (
        <p data-testid="topbar-recommended-reason" className="text-meta mb-block">
          <span className="font-semibold text-foreground">Why: </span>
          {TOPBAR_RECOMMENDED_REASON}
        </p>
      )}
      {states.map(({ scrollY, title }) => (
        <div key={scrollY} className="mb-stack flex flex-col gap-stack lg:flex-row lg:items-start">
          {SIZES.map(({ width, height }) => (
            <Shot
              key={width}
              candidate={candidate}
              width={width}
              height={height}
              scrollY={scrollY}
              label={`${title}, ${width}px`}
            />
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
        {THEME_CHECKS.map((preset) => (
          <Shot
            key={preset}
            candidate={candidate}
            width={1280}
            height={800}
            scrollY={TOPBAR_SCROLL}
            preset={preset}
            label={`${PRESET_BY_ID[preset].name} theme, scrolled, 1280px`}
          />
        ))}
      </div>
    </div>
  );
}
