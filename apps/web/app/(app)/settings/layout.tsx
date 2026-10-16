import type { ReactNode } from 'react';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import { SettingsHeader, SettingsContent } from '@/components/settings/SettingsHeader';
import { BuildStamp } from '@/components/settings/BuildStamp';
import { AppUpdateCard } from '@/components/settings/AppUpdateCard';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <SettingsHeader />
      {/* Side nav from lg only: at md the sidebar already takes 240px, and a
          second column left the page ~230px (bughunt V8). From md to lg the tabs
          remain a row; phones use the grouped Settings home. */}
      <div className="flex flex-col lg:flex-row gap-stack lg:gap-section">
        <SettingsTabs />
        <SettingsContent>{children}</SettingsContent>
      </div>
      {/* The Android app's updater: its version, where the update is, and
          Check for updates. Renders nothing outside the Android app. */}
      <AppUpdateCard />
      {/* Build stamp, NEXT_PUBLIC_APP_VERSION is inlined at build time
          (git SHA + build date, see next.config.ts). Inside the desktop or
          phone app, that app's own version follows it. */}
      <div className="mt-section text-xs text-muted-foreground/60">
        <BuildStamp build={process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown'} />
      </div>
    </div>
  );
}
