import { CarIcon, CloudArrowDownIcon, AddPersonIcon, FlagIcon, MusicIcon, PeopleIcon, type Icon } from '@/components/icons';

export type AdminSectionId = 'users' | 'invites' | 'tracks' | 'pranks' | 'backups' | 'car';

export interface AdminSection {
  id: AdminSectionId;
  href: string;
  label: string;
  icon: Icon;
}

/** Admin's sections, in order: the desktop tabs and the phone tiles. */
export const ADMIN_SECTIONS: AdminSection[] = [
  { id: 'users', href: '/admin/users', label: 'Users', icon: PeopleIcon },
  { id: 'invites', href: '/admin/invites', label: 'Invites', icon: AddPersonIcon },
  { id: 'tracks', href: '/admin/tracks', label: 'Tracks', icon: MusicIcon },
  { id: 'pranks', href: '/admin/pranks', label: 'Pranks', icon: FlagIcon },
  { id: 'backups', href: '/admin/backups', label: 'Backups', icon: CloudArrowDownIcon },
  { id: 'car', href: '/admin/car', label: 'Car and Android Auto', icon: CarIcon },
];

/** The section a path is in, or null on Admin's own page (/admin). */
export function adminSectionFor(path: string): AdminSection | null {
  return ADMIN_SECTIONS.find((s) => path === s.href || path.startsWith(`${s.href}/`)) ?? null;
}
