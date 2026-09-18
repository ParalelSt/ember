import type { PickerOption } from '@/components/library/options';

export type ChangelogPlacement = 'sidebar-link' | 'sidebar-card' | 'home-banner' | 'top-bar';
export type ChangelogState = 'unread' | 'open' | 'read';
export type BadgeStyle = 'pulse' | 'dot';

/** "What's new" entry point candidates, in picker order. `id` is what
 *  persists to localStorage; `description` is the one-liner under the
 *  preview (what it is, and where it lives on phone). */
export const CHANGELOG_PLACEMENTS: (PickerOption & { id: ChangelogPlacement })[] = [
  {
    id: 'sidebar-link',
    name: 'Sidebar link',
    description:
      'A "What\'s new" row in the sidebar nav with the New tag at its right edge; opens a full page. On phone the row lives in the menu drawer and the menu button gets an ember dot.',
  },
  {
    id: 'sidebar-card',
    name: 'Sidebar card',
    description:
      'A small card pinned above the profile row with the latest entry; opens a full page. On phone the card sits in the menu drawer and the menu button gets an ember dot.',
  },
  {
    id: 'home-banner',
    name: 'Home banner',
    description:
      'A dismissable card at the top of Home with the latest entry; opens a full page. Same on phone. Once read it goes away, and the page stays reachable from Settings > Help.',
  },
  {
    id: 'top-bar',
    name: 'Top bar button',
    description:
      'A sparkle button in the top-right corner of the content column that opens a popover list (no page). On phone it takes the empty slot right of the logo, which also centres the logo.',
  },
];

export const CHANGELOG_STATES: (PickerOption & { id: ChangelogState })[] = [
  { id: 'unread', name: 'Unread', description: 'Something new: the New tag pulses until it is read.' },
  { id: 'open', name: 'Open', description: 'The changelog open, with Mark all as read and the switch to hide New tags.' },
  { id: 'read', name: 'Read', description: 'Everything read: no tag, the entry point is still there but quiet.' },
];

export const BADGE_STYLES: (PickerOption & { id: BadgeStyle })[] = [
  { id: 'pulse', name: 'Pulse', description: 'The ember New pill itself softly pulses.' },
  { id: 'dot', name: 'Dot', description: 'A static New pill with a small pulsing ember dot beside it.' },
];
