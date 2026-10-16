'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PageTitle } from '@/components/page/PageTitle';
import { BackButton } from '@/components/ui/back-button';
import { SETTINGS_TABS } from './SettingsTabs';

export function SettingsHeader() {
  const path = usePathname();
  const section = SETTINGS_TABS.find(tab => path === tab.href || path.startsWith(`${tab.href}/`));
  return <>
    {section && <div className="mb-block flex min-w-0 items-center gap-cluster md:hidden">
      <BackButton href="/settings" label="Back to Settings" />
      <h1 className="min-w-0 flex-1 truncate text-section-title">{section.label}</h1>
    </div>}
    <PageTitle className={section ? 'mb-stack hidden md:block' : 'mb-stack'}>Settings</PageTitle>
  </>;
}

/** Older plain sections get a card on phones. Sections that already own
 * their cards keep their content and layout intact. */
export function SettingsContent({ children }: { children: ReactNode }) {
  const path = usePathname();
  const plain = ['/settings/profile', '/settings/library', '/settings/help'].includes(path);
  return <div className={plain ? 'flex-1 min-w-0 max-md:rounded-lg max-md:bg-card max-md:p-block' : 'flex-1 min-w-0'}>{children}</div>;
}
