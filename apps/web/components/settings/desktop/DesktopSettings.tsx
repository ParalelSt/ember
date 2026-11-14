'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PageTitle } from '@/components/page/PageTitle';
import {
  ArtistIcon,
  DevicesIcon,
  DownloadIcon,
  InfoIcon,
  SettingsIcon as PluginsIcon,
  SlidersIcon,
  UploadIcon,
  type Icon,
} from '@/components/icons';
import { useSettingsDesktop } from '@/components/settings/useSettingsDesktop';
import { AppearanceEditor } from '@/components/settings/appearance/AppearanceEditor';
import { cn } from '@/lib/utils';
import { AccountSection } from './AccountSection';
import { DevicesSection } from './DevicesSection';
import { DownloadsSection } from './DownloadsSection';
import { HelpSection, PluginsSection } from './RowSections';
import { UploadsSection } from './UploadsSection';

/** A section of desktop Settings. Its id is its route segment
 *  (/settings/<id>), so links and the back arrow keep working. */
interface Section {
  id: string;
  label: string;
  icon: Icon;
  /** A wide editor of its own (Appearance's preview and inspector). */
  wide?: boolean;
  render: () => ReactNode;
}

/** The menu's sections. Nothing the app sidebar already has: What's new
 *  and Admin live there, and the phone's Library settings are split into
 *  Uploads (Transfer) and Account (Blocked songs). */
function useSections(): Section[] {
  return [
    { id: 'profile', label: 'Account', icon: ArtistIcon, render: () => <AccountSection /> },
    { id: 'devices', label: 'Devices', icon: DevicesIcon, render: () => <DevicesSection /> },
    { id: 'appearance', label: 'Appearance', icon: SlidersIcon, wide: true, render: () => <AppearanceEditor rows /> },
    { id: 'plugins', label: 'Plugins', icon: PluginsIcon, render: () => <PluginsSection /> },
    { id: 'downloads', label: 'Downloads', icon: DownloadIcon, render: () => <DownloadsSection /> },
    { id: 'uploads', label: 'Uploads', icon: UploadIcon, render: () => <UploadsSection /> },
    { id: 'help', label: 'Help', icon: InfoIcon, render: () => <HelpSection /> },
  ];
}

/** A section's content, every one drawn as rows (rows C). */
function SectionBody({ section }: { section: Section }) {
  return (
    <div data-settings-section-body={section.id} className={section.wide ? 'max-w-5xl' : 'max-w-3xl'}>
      {section.render()}
    </div>
  );
}

const MENU_ROW = 'flex items-center gap-row rounded-md px-row py-cluster text-sm font-medium transition-colors';
const MENU_ON = 'bg-ember/14 text-foreground';
const MENU_OFF = 'text-foreground/70 hover:bg-secondary/60 hover:text-foreground';

function MenuItem({ href, label, icon: Icon, active }: { href: string; label: string; icon: Icon; active?: boolean }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cn(MENU_ROW, active ? MENU_ON : MENU_OFF)}>
      <Icon className={cn('size-4', active && 'text-ember')} />
      {label}
    </Link>
  );
}

/** Desktop Settings (owner pick: layout A): a slim menu styled like the app
 *  sidebar, the open section beside it under one heading. */
function MenuLayout({ sections, active }: { sections: Section[]; active: Section }) {
  return (
    <div data-settings-layout="menu" className="flex items-start gap-section">
      <div className="w-52 shrink-0">
        <PageTitle className="mb-block px-row">Settings</PageTitle>
        <nav aria-label="Settings" className="flex flex-col gap-inset">
          {sections.map((s) => (
            <MenuItem key={s.id} href={`/settings/${s.id}`} label={s.label} icon={s.icon} active={s.id === active.id} />
          ))}
        </nav>
      </div>
      <div className="min-w-0 flex-1 pt-cluster">
        <h2 className="mb-stack text-section-title">{active.label}</h2>
        <SectionBody section={active} />
      </div>
    </div>
  );
}

/** Desktop Settings. /settings itself, or a section desktop does not have
 *  (/settings/library, a phone page), opens Account. */
export function DesktopSettings() {
  const path = usePathname() ?? '/settings';
  const router = useRouter();
  const sections = useSections();
  const segment = path.split('/')[2];
  const active = sections.find((s) => s.id === segment);
  const needsSection = !active;
  useEffect(() => {
    if (needsSection) router.replace('/settings/profile');
  }, [needsSection, router]);

  return <MenuLayout sections={sections} active={active ?? sections[0]} />;
}

/** Settings' frame: desktop (lg and up) gets the menu layout, phones and
 *  narrow windows keep `phone`, exactly as before. */
export function SettingsFrame({ phone }: { phone: ReactNode }) {
  const desktop = useSettingsDesktop();
  return desktop ? <DesktopSettings /> : <>{phone}</>;
}
