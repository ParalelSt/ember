'use client';

import { MusicIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TrackCard } from '@/components/track/TrackCard';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { PhonePlayerBar, PLAYER_BAR_CHROME } from '@/components/player/PhonePlayerBar';
import {
  BAR_COLOR_OPTIONS,
  BAR_COLOR_RECOMMENDED,
} from '@/components/library/options/barcolors';
import { MOCK_HOME_TRACKS, MOCK_MOBILE_NOW_PLAYING } from '@/app/(app)/dizajn/mock';

const FRAME_W = 390;
// Tall enough for the page title and a row of cards above the bar and nav,
// so the colours are judged against the page, not in isolation.
const FRAME_H = 460;

function MockHome() {
  return (
    <div>
      <PageTitle className="mb-stack text-3xl!">Home</PageTitle>
      <SectionHeader title="Recently played" className="mb-row" />
      <div className="grid grid-cols-2 gap-block">
        {MOCK_HOME_TRACKS.slice(0, 2).map((t) => (
          <TrackCard key={t.id} track={t} onActivate={() => {}} artworkFallback={<MusicIcon className="h-6 w-6" />} />
        ))}
      </div>
    </div>
  );
}

/** One phone frame per colour option, each around the REAL PhonePlayerBar
 *  (on mock data, inert handlers) in the mock shell, so only colour differs
 *  between them and nothing can drift from what ships. */
export function BarColorsSection() {
  return (
    <div data-testid="barcolors-section" className="grid grid-cols-1 gap-stack sm:grid-cols-2 xl:grid-cols-3">
      {BAR_COLOR_OPTIONS.map((opt) => (
        <div key={opt.id} data-testid="barcolors-option" data-option={opt.id} className="min-w-0">
          <div className="mb-cluster flex min-h-7 items-center gap-row">
            <div className="text-eyebrow">{opt.label}</div>
            {opt.id === BAR_COLOR_RECOMMENDED && (
              <span className="rounded-full bg-ring/15 px-row text-xs font-medium text-ring">Recommended</span>
            )}
          </div>
          <div data-testid="barcolors-frame" className={opt.className}>
            <ScaledFrame width={FRAME_W} height={FRAME_H}>
              <ShellPreview
                phone
                activePath="/"
                content={<MockHome />}
                playerBar={
                  <footer data-testid="player-bar" className={PLAYER_BAR_CHROME}>
                    <PhonePlayerBar
                      track={MOCK_MOBILE_NOW_PLAYING}
                      playing={false}
                      position={24}
                      duration={MOCK_MOBILE_NOW_PLAYING.durationSec ?? 264}
                      onToggle={() => {}}
                      onSeek={() => {}}
                      onNext={() => {}}
                      onOpen={() => {}}
                    />
                  </footer>
                }
              />
            </ScaledFrame>
          </div>
          <p className="text-meta mt-cluster">{opt.blurb}</p>
        </div>
      ))}
    </div>
  );
}
