'use client';

import { MusicIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TrackCard } from '@/components/track/TrackCard';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { AndroidNavStrip } from '@/components/library/options/mobileplayer/AndroidNavStrip';
import { PhonePlayerBar } from '@/components/player/PhonePlayerBar';
import {
  ANDROID_NAV_PX,
  BEFORE_TAPS,
  BEFORE_TITLE_PX,
  SHIPPED_TAPS,
  SHIPPED_TITLE_PX,
} from '@/components/library/options/mobileplayer';
import { MOCK_HOME_TRACKS, MOCK_MOBILE_NOW_PLAYING } from '@/app/(app)/dizajn/mock';

const FRAME_H = 720;

/** The three frames the shipped bar is shown in: the phone frame the rest
 *  of the gallery uses, the same frame with Android's navigation bar drawn
 *  over it, and a small Android phone (360) with the same strip. The two
 *  Android frames keep the bug visible: the strip is drawn OVER the shell,
 *  so if the safe-area lift ever stops working it is obvious here. */
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

/** The phone player bar as it ships, inside the mock app shell at the two
 *  widths Android phones actually are, with the system navigation bar drawn
 *  over two of the three frames.
 *
 *  The bar is the REAL `PhonePlayerBar` the app renders, on mock data and
 *  with inert handlers, so this section cannot drift from what ships. The
 *  shell around it is mock markup (the real one reads auth, queries and
 *  stores). The frames publish `--ember-inset-bottom`, the same custom
 *  property MainActivity sets from the window insets on a real phone, so
 *  the lift shown here is the lift the CSS actually performs. */
export function MobilePlayerSection() {
  return (
    <div data-testid="mobileplayer-section">
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
                playerBar={
                  <PhonePlayerBar
                    track={MOCK_MOBILE_NOW_PLAYING}
                    playing
                    position={92}
                    duration={MOCK_MOBILE_NOW_PLAYING.durationSec ?? 264}
                    onToggle={() => {}}
                    onNext={() => {}}
                    onPrev={() => {}}
                    onSeek={() => {}}
                    onOpen={() => {}}
                    onQueue={() => {}}
                  />
                }
                bottomInset={ANDROID_NAV_PX}
                systemNav={frame.systemNav ? <AndroidNavStrip /> : undefined}
              />
            </ScaledFrame>
          </div>
        ))}
      </div>

      <div className="mt-block flex flex-col gap-cluster">
        <p data-testid="mobileplayer-taps" className="text-meta">
          <span className="font-semibold text-foreground">Tap targets:</span> {SHIPPED_TAPS}. Song name
          box: {SHIPPED_TITLE_PX}px at 390, {SHIPPED_TITLE_PX - 30}px at 360. Before, for comparison:{' '}
          {BEFORE_TAPS}, song name box {BEFORE_TITLE_PX}px at 390.
        </p>
      </div>
    </div>
  );
}
