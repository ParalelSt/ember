'use client';

import { MusicIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TrackCard } from '@/components/track/TrackCard';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { AndroidNavStrip } from '@/components/library/options/mobileplayer/AndroidNavStrip';
import { MobilePlayerBar } from '@/components/library/options/mobileplayer/MobilePlayerBar';
import {
  ANDROID_NAV_PX,
  MOBILE_PLAYER_LAYOUTS,
  MOBILE_TITLE_OPTIONS,
  TODAY_TAPS,
  TODAY_TITLE_PX,
  type MobileInsetOption,
  type MobilePlayerLayout,
  type MobileTitleOption,
} from '@/components/library/options/mobileplayer';
import { MOCK_HOME_TRACKS, MOCK_MOBILE_NOW_PLAYING } from '@/app/(app)/dizajn/mock';

const FRAME_H = 720;

/** The three frames the candidates are judged in: the phone frame the rest
 *  of the gallery uses, the same frame with Android's navigation bar drawn
 *  over it, and a small Android phone (360) with the same strip. */
const FRAMES: { id: string; label: string; width: number; systemNav: boolean }[] = [
  { id: 'clean-390', label: 'Phone (390px)', width: 390, systemNav: false },
  { id: 'android-390', label: 'Phone (390px), Android nav', width: 390, systemNav: true },
  { id: 'android-360', label: 'Small phone (360px), Android nav', width: 360, systemNav: true },
];

/** A stand-in Home page behind the bar: two real TrackCards under the page
 *  title, which is all that is needed for the bar to sit on something that
 *  looks like Ember. */
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

export interface MobilePlayerSectionProps {
  layout: MobilePlayerLayout;
  title: MobileTitleOption;
  inset: MobileInsetOption;
}

/** The mobile player-bar candidates, each inside the mock app shell at the
 *  two widths Android phones actually are, with the system navigation bar
 *  drawn over two of the three frames. Mock data only: no player, no
 *  stores, no network. The live PlayerBar and MobileNav are untouched. */
export function MobilePlayerSection({ layout, title, inset }: MobilePlayerSectionProps) {
  const option = MOBILE_PLAYER_LAYOUTS.find((o) => o.id === layout) ?? MOBILE_PLAYER_LAYOUTS[0];
  const titleOption = MOBILE_TITLE_OPTIONS.find((o) => o.id === title) ?? MOBILE_TITLE_OPTIONS[0];
  const bottomInset = inset === 'safe-area' ? ANDROID_NAV_PX : 0;

  return (
    <div data-testid="mobileplayer-section" data-layout={layout} data-title={title} data-inset={inset}>
      <div className="flex flex-wrap items-start gap-stack">
        {FRAMES.map((frame) => (
          <div
            key={frame.id}
            data-testid="mobileplayer-frame"
            data-frame={frame.id}
            className="w-full min-w-0 max-w-[390px] flex-[390_1_0%]"
          >
            <div className="mb-cluster flex min-h-7 items-center">
              <div className="text-eyebrow">{frame.label}</div>
            </div>
            <ScaledFrame width={frame.width} height={FRAME_H}>
              <ShellPreview
                phone
                activePath="/"
                content={<MockHome />}
                playerBar={<MobilePlayerBar layout={layout} title={title} track={MOCK_MOBILE_NOW_PLAYING} />}
                bottomInset={bottomInset}
                systemNav={frame.systemNav ? <AndroidNavStrip /> : undefined}
              />
            </ScaledFrame>
          </div>
        ))}
      </div>

      <div className="mt-block flex flex-col gap-cluster">
        <p data-testid="mobileplayer-description" className="text-meta">
          <span className="font-semibold text-foreground">{option.name}.</span> {option.description}
        </p>
        <p data-testid="mobileplayer-taps" className="text-meta">
          <span className="font-semibold text-foreground">Tap targets:</span> {option.taps}. Song name box:{' '}
          {option.titleBox}. Today, for comparison: {TODAY_TAPS}, song name box {TODAY_TITLE_PX}px at 390.
        </p>
        <p data-testid="mobileplayer-title-description" className="text-meta">
          <span className="font-semibold text-foreground">{titleOption.name}.</span> {titleOption.description}
        </p>
      </div>
    </div>
  );
}
