'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { PageTitle } from '@/components/page/PageTitle';
import {
  ArtistIcon,
  DevicesIcon,
  DownloadIcon,
  InfoIcon,
  LibraryIcon,
  SettingsIcon as PluginsIcon,
  ShieldIcon,
  SlidersIcon,
  SparklesIcon,
  UploadIcon,
  type Icon,
} from '@/components/icons';
import { useSettingsDesktop } from '@/components/settings/useSettingsDesktop';
import SettingsAppearance from '@/app/(app)/settings/appearance/page';
import SettingsDevices from '@/app/(app)/settings/devices/page';
import DownloadsSettingsPage from '@/app/(app)/settings/downloads/page';
import UploadsPage from '@/app/(app)/settings/uploads/page';
import { cn } from '@/lib/utils';
import { AccountSection } from './AccountSection';
import { HelpSection, LibrarySection, PluginsSection } from './RowSections';

/** A section of desktop Settings. Its id is its route segment
 *  (/settings/<id>), so links and the back arrow keep working. */
interface Section {
  id: string;
  label: string;
  icon: Icon;
  /** Sections with a wide editor of their own (Appearance, Devices). */
  wide?: boolean;
  /** Pages kept whole (their own cards and controls), not drawn as rows. */
  embedded?: boolean;
  render: () => ReactNode;
}

/** Items that open another page instead of a section. */
interface OutLink {
  href: string;
  label: string;
  icon: Icon;
}

function useSections() {
  const { isAdmin } = useAuth();
  const sections: Section[] = [
    { id: 'profile', label: 'Account', icon: ArtistIcon, render: () => <AccountSection /> },
    { id: 'devices', label: 'Devices', icon: DevicesIcon, wide: true, embedded: true, render: () => <SettingsDevices /> },
    { id: 'appearance', label: 'Appearance', icon: SlidersIcon, wide: true, embedded: true, render: () => <SettingsAppearance /> },
    { id: 'plugins', label: 'Plugins', icon: PluginsIcon, render: () => <PluginsSection /> },
    { id: 'library', label: 'Library', icon: LibraryIcon, render: () => <LibrarySection /> },
    { id: 'downloads', label: 'Downloads', icon: DownloadIcon, embedded: true, render: () => <DownloadsSettingsPage /> },
    { id: 'uploads', label: 'Uploads', icon: UploadIcon, embedded: true, render: () => <UploadsPage /> },
    { id: 'help', label: 'Help', icon: InfoIcon, render: () => <HelpSection /> },
  ];
  const links: OutLink[] = [{ href: '/whats-new', label: "What's new", icon: SparklesIcon }];
  if (isAdmin) links.push({ href: '/admin', label: 'Admin', icon: ShieldIcon });
  return { sections, links };
}

/** A section's content. Kept pages lose their own first heading, the
 *  layout already shows one. */
function SectionBody({ section }: { section: Section }) {
  return (
    <div
      data-settings-section-body={section.id}
      className={cn(
        section.wide ? 'max-w-5xl' : 'max-w-3xl',
        section.embedded && '[&>section:first-child>h2:first-child]:hidden [&>section:first-child>header>h2:first-child]:hidden',
      )}
    >
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
function MenuLayout({ sections, links, active }: { sections: Section[]; links: OutLink[]; active: Section }) {
  return (
    <div data-settings-layout="menu" className="flex items-start gap-section">
      <div className="w-52 shrink-0">
        <PageTitle className="mb-block px-row">Settings</PageTitle>
        <nav aria-label="Settings" className="flex flex-col gap-inset">
          {sections.map((s) => (
            <MenuItem key={s.id} href={`/settings/${s.id}`} label={s.label} icon={s.icon} active={s.id === active.id} />
          ))}
          {links.map((l) => (
            <MenuItem key={l.href} href={l.href} label={l.label} icon={l.icon} />
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

/** Desktop Settings. /settings itself (or an unknown section) opens
 *  Account. */
export function DesktopSettings() {
  const path = usePathname() ?? '/settings';
  const router = useRouter();
  const { sections, links } = useSections();
  const segment = path.split('/')[2];
  const active = sections.find((s) => s.id === segment);
  const needsSection = !active;
  useEffect(() => {
    if (needsSection) router.replace('/settings/profile');
  }, [needsSection, router]);

  return <MenuLayout sections={sections} links={links} active={active ?? sections[0]} />;
}

/** Settings' frame: desktop (lg and up) gets the menu layout, phones and
 *  narrow windows keep `phone`, exactly as before. */
export function SettingsFrame({ phone }: { phone: ReactNode }) {
  const desktop = useSettingsDesktop();
  return desktop ? <DesktopSettings /> : <>{phone}</>;
}
