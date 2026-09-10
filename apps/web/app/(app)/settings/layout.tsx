import type { ReactNode } from 'react';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import { PageTitle } from '@/components/page/PageTitle';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <PageTitle className="mb-6">Settings</PageTitle>
      <div className="flex flex-col md:flex-row gap-6 md:gap-10">
        <SettingsTabs />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      {/* Build stamp — NEXT_PUBLIC_APP_VERSION is inlined at build time
          (git SHA + build date, see next.config.ts). */}
      <div className="mt-10 text-xs text-muted-foreground/60">
        Ember build {process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown'}
      </div>
    </div>
  );
}
