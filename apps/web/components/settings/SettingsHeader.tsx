'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PageTitle } from '@/components/page/PageTitle';
import { BackButton } from '@/components/ui/back-button';
import { useSettingsGroups } from './SettingsPicker';

/** The phone Settings header (desktop has its own, components/settings/
 *  desktop): "Settings" on the list, a back arrow and the section's name
 *  inside one. */
export function SettingsHeader() {
  const path = usePathname();
  const sections = useSettingsGroups().flatMap(group => group.rows);
  const section = sections.find(tab => path === tab.href || path.startsWith(`${tab.href}/`));
  return <>
    {section && <div className="mb-block flex min-w-0 items-center gap-cluster lg:hidden">
      <BackButton href="/settings" label="Back to Settings" className="md:hidden" />
      <h1 className="min-w-0 flex-1 truncate text-section-title">{section.label}</h1>
    </div>}
    <PageTitle className={section ? 'mb-stack hidden lg:block' : 'mb-stack'}>Settings</PageTitle>
  </>;
}

/** Older plain sections get a card on phones. Sections that already own
 * their cards keep their content and layout intact. */
export function SettingsContent({ children }: { children: ReactNode }) {
  const path = usePathname();
  const plain = ['/settings/profile', '/settings/help'].includes(path);
  return <div className="min-w-0 flex-1 lg:max-w-3xl">
    <div className={plain ? 'flex-1 min-w-0 max-lg:rounded-lg max-lg:bg-card max-lg:p-block' : 'flex-1 min-w-0'}>{children}</div>
  </div>;
}
