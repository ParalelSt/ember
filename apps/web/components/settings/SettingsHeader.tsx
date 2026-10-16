'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PageTitle } from '@/components/page/PageTitle';
import { BackButton } from '@/components/ui/back-button';
import { useSettingsDesktop } from './useSettingsDesktop';
import { SettingsIcon, useSettingsGroups } from './SettingsPicker';

export function SettingsHeader() {
  const path = usePathname();
  const desktop = useSettingsDesktop();
  const sections = useSettingsGroups().flatMap(group => group.rows);
  const section = sections.find(tab => path === tab.href || path.startsWith(`${tab.href}/`));
  return <>
    {!desktop && section && <div className="mb-block flex min-w-0 items-center gap-cluster lg:hidden">
      <BackButton href="/settings" label="Back to Settings" />
      <h1 className="min-w-0 flex-1 truncate text-section-title">{section.label}</h1>
    </div>}
    <PageTitle className={section ? 'mb-stack hidden lg:block' : 'mb-stack'}>Settings</PageTitle>
  </>;
}

/** Older plain sections get a card on phones. Sections that already own
 * their cards keep their content and layout intact. */
export function SettingsContent({ children }: { children: ReactNode }) {
  const path = usePathname();
  const plain = ['/settings/profile', '/settings/library', '/settings/help'].includes(path);
  const desktop = useSettingsDesktop();
  const sections = useSettingsGroups().flatMap(group => group.rows);
  const section = sections.find(row => path === row.href || path.startsWith(`${row.href}/`));
  return <div className="min-w-0 flex-1 lg:max-w-3xl">
    {desktop && section && <div className="mb-stack flex items-center gap-row border-b border-border pb-block">
      <SettingsIcon icon={section.icon} hue={section.hue} />
      <h2 className="text-section-title">{section.label}</h2>
    </div>}
    <div className={plain ? 'flex-1 min-w-0 max-lg:rounded-lg max-lg:bg-card max-lg:p-block' : 'flex-1 min-w-0'}>{children}</div>
  </div>;
}
