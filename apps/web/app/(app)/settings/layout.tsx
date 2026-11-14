import type { ReactNode } from 'react';
import { SettingsHeader, SettingsContent } from '@/components/settings/SettingsHeader';
import { BuildStamp } from '@/components/settings/BuildStamp';
import { AppUpdateCard } from '@/components/settings/AppUpdateCard';
import { SettingsFrame } from '@/components/settings/desktop/DesktopSettings';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      {/* Desktop (lg and up) draws its own menu layout (components/
          settings/desktop); phones and narrow windows keep this one. */}
      <SettingsFrame
        phone={
          <>
            <SettingsHeader />
            <SettingsContent>{children}</SettingsContent>
          </>
        }
        footer={
          <>
            {/* The Android app's updater: its version, where the update is, and
                Check for updates. Renders nothing outside the Android app. */}
            <AppUpdateCard />
            {/* Build stamp, NEXT_PUBLIC_APP_VERSION is inlined at build time
                (git SHA + build date, see next.config.ts). Inside the desktop or
                phone app, that app's own version follows it. */}
            <div className="mt-section text-xs text-muted-foreground/60">
              <BuildStamp build={process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown'} />
            </div>
          </>
        }
      />
    </div>
  );
}
