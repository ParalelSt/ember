'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { useSettingsGroups } from '@/components/settings/SettingsPicker';
import SettingsAppearance from '@/app/(app)/settings/appearance/page';
import SettingsDevices from '@/app/(app)/settings/devices/page';
import DownloadsSettingsPage from '@/app/(app)/settings/downloads/page';
import UploadsPage from '@/app/(app)/settings/uploads/page';
import { cn } from '@/lib/utils';
import { AccountSection } from './AccountSection';
import { HelpSection, LibrarySection, PluginsSection } from './RowSections';
import { SettingsRowsProvider } from './rows';
import { DesignPreviewSwitcher, useDesignFromUrl, useSettingsDesign, type EditVariant } from './DesignPreview';

/** A section of desktop Settings. Its id is its route segment
 *  (/settings/<id>), so links and the back arrow keep working. */
interface Section {
  id: string;
  label: string;
  icon: Icon;
  summary: string;
  /** Sections with a wide editor of their own (Appearance, Devices). */
  wide?: boolean;
  /** Pages kept whole (their own cards and controls), not drawn as rows. */
  embedded?: boolean;
  render: (edit: EditVariant) => ReactNode;
}

/** Items that open another page instead of a section. */
interface OutLink {
  href: string;
  label: string;
  icon: Icon;
  summary: string;
}

function useSections() {
  const { user, name, isAdmin } = useAuth();
  const values = Object.fromEntries(
    useSettingsGroups()
      .flatMap((g) => g.rows)
      .map((r) => [r.href, r.value]),
  );
  const sections: Section[] = [
    { id: 'profile', label: 'Account', icon: ArtistIcon, summary: name || user?.email || 'Name, picture, privacy', render: (edit) => <AccountSection edit={edit} /> },
    { id: 'devices', label: 'Devices', icon: DevicesIcon, summary: values['/settings/devices'] ?? 'Sign in another device', wide: true, embedded: true, render: () => <SettingsDevices /> },
    { id: 'appearance', label: 'Appearance', icon: SlidersIcon, summary: values['/settings/appearance'] ?? 'Themes and colours', wide: true, embedded: true, render: () => <SettingsAppearance /> },
    { id: 'plugins', label: 'Plugins', icon: PluginsIcon, summary: 'Normalize volume, equalizer', render: () => <PluginsSection /> },
    { id: 'library', label: 'Library', icon: LibraryIcon, summary: 'Transfer, blocked songs', render: () => <LibrarySection /> },
    { id: 'downloads', label: 'Downloads', icon: DownloadIcon, summary: values['/settings/downloads'] ?? 'Songs kept on this device', embedded: true, render: () => <DownloadsSettingsPage /> },
    { id: 'uploads', label: 'Uploads', icon: UploadIcon, summary: 'Songs you added', embedded: true, render: () => <UploadsPage /> },
    { id: 'help', label: 'Help', icon: InfoIcon, summary: 'Report a bug, send a request', render: () => <HelpSection /> },
  ];
  const links: OutLink[] = [{ href: '/whats-new', label: "What's new", icon: SparklesIcon, summary: 'What changed lately' }];
  if (isAdmin) links.push({ href: '/admin', label: 'Admin', icon: ShieldIcon, summary: 'Users, invites, tracks' });
  return { sections, links };
}

/** A section's content. Kept pages lose their own first heading, the
 *  layout already shows one. */
function SectionBody({ section, edit }: { section: Section; edit: EditVariant }) {
  return (
    <div
      data-settings-section-body={section.id}
      className={cn(
        section.wide ? 'max-w-5xl' : 'max-w-3xl',
        section.embedded && '[&>section:first-child>h2:first-child]:hidden [&>section:first-child>header>h2:first-child]:hidden',
      )}
    >
      {section.render(edit)}
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

/** Layout A: a slim menu styled like the app sidebar, the open section
 *  beside it under one heading. */
function MenuLayout({ sections, links, active, edit }: LayoutProps) {
  return (
    <div data-settings-layout="A" className="flex items-start gap-section">
      <div className="w-52 shrink-0">
        <PageTitle className="mb-block px-row">Settings</PageTitle>
        <nav aria-label="Settings" className="flex flex-col gap-inset">
          {sections.map((s) => (
            <MenuItem key={s.id} href={`/settings/${s.id}`} label={s.label} icon={s.icon} active={s.id === active?.id} />
          ))}
          {links.map((l) => (
            <MenuItem key={l.href} href={l.href} label={l.label} icon={l.icon} />
          ))}
        </nav>
      </div>
      {active && (
        <div className="min-w-0 flex-1 pt-cluster">
          <h2 className="mb-stack text-section-title">{active.label}</h2>
          <SectionBody section={active} edit={edit} />
        </div>
      )}
    </div>
  );
}

const TAB = 'whitespace-nowrap rounded-full px-block py-cluster text-sm font-semibold transition-colors';
const TAB_ON = 'bg-ember text-ember-foreground';
const TAB_OFF = 'bg-foreground/10 text-foreground hover:bg-foreground/20';

/** The pill tabs of layouts B and C, in the Library and Home filter chip
 *  style, stuck under the top bar while the page scrolls. */
function Tabs({ sections, links, activeId, onPick }: { sections: Section[]; links: OutLink[]; activeId?: string; onPick?: (id: string) => void }) {
  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-(--ember-topbar-h,0px) z-10 -mx-inset mb-stack flex flex-wrap gap-cluster bg-background px-inset py-cluster"
    >
      {sections.map((s) =>
        onPick ? (
          <button key={s.id} type="button" aria-pressed={s.id === activeId} onClick={() => onPick(s.id)} className={cn(TAB, s.id === activeId ? TAB_ON : TAB_OFF)}>
            {s.label}
          </button>
        ) : (
          <Link key={s.id} href={`/settings/${s.id}`} aria-current={s.id === activeId ? 'page' : undefined} className={cn(TAB, s.id === activeId ? TAB_ON : TAB_OFF)}>
            {s.label}
          </Link>
        ),
      )}
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={cn(TAB, TAB_OFF)}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** Layout B: one long page, every section stacked; the tabs scroll to one. */
function LongPageLayout({ sections, links, active, edit }: LayoutProps) {
  const [picked, setPicked] = useState(active?.id ?? sections[0].id);
  const opened = useRef(false);
  const scrollTo = (id: string) => {
    setPicked(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  // Opened on /settings/<id>: start at that section.
  useEffect(() => {
    if (opened.current || !active) return;
    opened.current = true;
    document.getElementById(`settings-${active.id}`)?.scrollIntoView?.({ block: 'start' });
  }, [active]);
  return (
    <div data-settings-layout="B">
      <PageTitle className="mb-block">Settings</PageTitle>
      <Tabs sections={sections} links={links} activeId={picked} onPick={scrollTo} />
      <div className="flex flex-col gap-section">
        {sections.map((s) => (
          <section
            key={s.id}
            id={`settings-${s.id}`}
            aria-labelledby={`settings-${s.id}-title`}
            className="scroll-mt-[calc(var(--ember-topbar-h,0px)+4rem)]"
          >
            <h2 id={`settings-${s.id}-title`} className="mb-stack text-section-title">
              {s.label}
            </h2>
            <SectionBody section={s} edit={edit} />
          </section>
        ))}
      </div>
    </div>
  );
}

/** Layout C: the same tabs, each showing only its own section. */
function TabsLayout({ sections, links, active, edit }: LayoutProps) {
  return (
    <div data-settings-layout="C">
      <PageTitle className="mb-block">Settings</PageTitle>
      <Tabs sections={sections} links={links} activeId={active?.id} />
      {active && (
        <section aria-label={active.label}>
          <SectionBody section={active} edit={edit} />
        </section>
      )}
    </div>
  );
}

/** Layout D: tiles like Home's cards; a tile opens its section full width,
 *  with the top bar's back arrow to return. */
function TilesLayout({ sections, links, active, edit }: LayoutProps) {
  if (active) {
    return (
      <div data-settings-layout="D">
        <PageTitle className="mb-stack">{active.label}</PageTitle>
        <SectionBody section={active} edit={edit} />
      </div>
    );
  }
  const tiles = [...sections.map((s) => ({ href: `/settings/${s.id}`, label: s.label, icon: s.icon, summary: s.summary })), ...links];
  return (
    <div data-settings-layout="D">
      <PageTitle className="mb-stack">Settings</PageTitle>
      <ul aria-label="Settings sections" className="grid max-w-5xl grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-block">
        {tiles.map(({ href, label, icon: Icon, summary }) => (
          <li key={href}>
            <Link href={href} className="flex h-full min-h-36 flex-col gap-row rounded-lg bg-card p-stack transition-colors hover:bg-accent">
              <span aria-hidden className="grid size-10 place-items-center rounded-md bg-ember/14 text-ember">
                <Icon className="size-5" />
              </span>
              <span className="text-lg font-bold">{label}</span>
              <span className="text-meta line-clamp-2">{summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface LayoutProps {
  sections: Section[];
  links: OutLink[];
  active?: Section;
  edit: EditVariant;
}

/** Desktop Settings in the variant picked in the Design preview. */
export function DesktopSettings() {
  useDesignFromUrl();
  const design = useSettingsDesign();
  const path = usePathname() ?? '/settings';
  const router = useRouter();
  const { sections, links } = useSections();
  const segment = path.split('/')[2];
  const active = sections.find((s) => s.id === segment);
  // Menu and tabs always show a section: /settings opens Account.
  const needsSection = !segment && (design.layout === 'A' || design.layout === 'C');
  useEffect(() => {
    if (needsSection) router.replace('/settings/profile');
  }, [needsSection, router]);

  const props: LayoutProps = { sections, links, active: active ?? (needsSection ? sections[0] : undefined), edit: design.edit };
  return (
    <SettingsRowsProvider value={design.rows}>
      <div className="relative">
        {design.layout === 'B' ? (
          <LongPageLayout {...props} />
        ) : design.layout === 'C' ? (
          <TabsLayout {...props} />
        ) : design.layout === 'D' ? (
          <TilesLayout {...props} />
        ) : (
          <MenuLayout {...props} />
        )}
        <DesignPreviewSwitcher />
      </div>
    </SettingsRowsProvider>
  );
}

/** Settings' frame: desktop (lg and up) gets the variant layouts, phones
 *  and narrow windows keep `phone`, exactly as before. */
export function SettingsFrame({ phone }: { phone: ReactNode }) {
  const desktop = useSettingsDesktop();
  return desktop ? <DesktopSettings /> : <>{phone}</>;
}
