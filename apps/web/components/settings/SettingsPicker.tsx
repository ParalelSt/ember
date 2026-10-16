'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers/AuthProvider';
import { Avatar } from '@/components/primitives/Avatar';
import { ADMIN_SECTIONS } from '@/components/admin/sections';
import { ArtistIcon, SlidersIcon, LibraryIcon, DownloadIcon, UploadIcon, SettingsIcon as PluginsIcon, DevicesIcon, InfoIcon, SparklesIcon, ChevronRightIcon, type Icon } from '@/components/icons';
import { useThemeStore } from '@/stores/useThemeStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { formatBytes } from '@/lib/format';
import { deviceLabel } from '@/lib/qrLogin/device';
import { detectShell } from '@/lib/playback/detectShell';
import styles from './SettingsHome.module.css';

interface Row { href: string; label: string; icon: Icon; hue: number; value?: string }

const subscribe = () => () => {};
const deviceSnapshot = () => {
  const label = deviceLabel(navigator.userAgent, detectShell());
  return label === 'A browser' ? undefined : label;
};
const serverDevice = () => undefined;

export function useSettingsGroups() {
  const { isAdmin } = useAuth();
  const theme = useThemeStore(s => s.doc);
  const hydrated = useOfflineStore(s => s.hydrated);
  const bytes = useOfflineStore(s => s.totalBytes);
  const device = useSyncExternalStore(subscribe, deviceSnapshot, serverDevice);
  const groups: { name: string; rows: Row[] }[] = [
    { name: 'Account', rows: [
      { href: '/settings/profile', label: 'Profile', icon: ArtistIcon, hue: 250 },
      { href: '/settings/devices', label: 'Devices', icon: DevicesIcon, hue: 40, value: device },
    ] },
    { name: 'App', rows: [
      { href: '/settings/appearance', label: 'Appearance', icon: SlidersIcon, hue: 8, value: theme.name || (theme.custom ? undefined : PRESET_BY_ID[theme.preset].name) },
      { href: '/settings/plugins', label: 'Plugins', icon: PluginsIcon, hue: 285 },
      { href: '/settings/help', label: 'Help', icon: InfoIcon, hue: 180 },
      { href: '/whats-new', label: "What's new", icon: SparklesIcon, hue: 8 },
    ] },
    { name: 'Music', rows: [
      { href: '/settings/library', label: 'Library', icon: LibraryIcon, hue: 200 },
      { href: '/settings/downloads', label: 'Downloads', icon: DownloadIcon, hue: 150, value: hydrated ? formatBytes(bytes) : undefined },
      { href: '/settings/uploads', label: 'Uploads', icon: UploadIcon, hue: 40 },
    ] },
  ];
  if (isAdmin) groups.push({ name: 'Admin', rows: ADMIN_SECTIONS.map((row, index) => ({ ...row, hue: [330, 55, 210, 300, 100, 20][index] })) });
  return groups;
}

export function SettingsIcon({ icon: Icon, hue }: Pick<Row, 'icon' | 'hue'>) {
  return <span aria-hidden style={{ '--settings-icon-hue': hue } as CSSProperties} className={`grid size-9 shrink-0 place-items-center rounded-md ${styles.icon}`}><Icon className="size-5" /></span>;
}

export function SettingsPicker({ activePath }: { activePath?: string }) {
  const { user, name, avatarUrl } = useAuth();
  const groups = useSettingsGroups();
  return (
    <div className="space-y-stack">
      <div className="flex items-center gap-row rounded-lg bg-card p-block">
        <Avatar src={avatarUrl} name={name} email={user?.email} className="size-art-bar bg-ember/15 text-ember text-xl" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{name || user?.email}</div>
          {user?.email && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
        </div>
        <Link href="/settings/profile" className="inline-flex min-h-hit items-center rounded-full bg-muted px-block text-sm font-semibold hover:bg-muted/80">Edit</Link>
      </div>
      {groups.map(group => (
        <section key={group.name} aria-labelledby={`settings-${group.name}`}>
          <h2 id={`settings-${group.name}`} className="mb-cluster px-inset text-xs font-semibold uppercase tracking-widest text-muted-foreground">{group.name}</h2>
          <ul aria-label={group.name} className="overflow-hidden rounded-lg bg-card divide-y divide-border">
            {group.rows.map(({ href, label, icon, hue, value }) => (
              <li key={href}>
                <Link href={href} aria-current={activePath && (activePath === href || activePath.startsWith(`${href}/`)) ? 'page' : undefined} className={cn('flex min-h-14 items-center gap-row px-block py-row transition-colors hover:bg-muted/50', activePath && (activePath === href || activePath.startsWith(`${href}/`)) && 'bg-muted text-foreground')}>
                  <SettingsIcon icon={icon} hue={hue} />
                  <span className="min-w-0 flex-1">
                    <span data-settings-label className="block text-sm font-semibold">{label}</span>
                    {value && <span data-settings-value className="block truncate text-xs text-muted-foreground">{value}</span>}
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
