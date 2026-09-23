import type { PickerOption } from '@/components/library/options';

/** Design candidates for the admin Pranks tab
 *  (docs/superpowers/plans/2026-09-23-admin-pranks.md, Task 0): the whole
 *  job in one page, in three shapes. Mock data only; Tasks 1-7 build the
 *  pipeline this draws a front end for, Task 8 builds the winner. */

export type PrankOptionId = 'control-room' | 'card-per-person' | 'wizard';
export type PrankStateId = 'idle' | 'listening' | 'repeat' | 'off';

export interface PrankOption extends PickerOption {
  id: PrankOptionId;
}

/** The three shapes for the Pranks tab (plan section 7), in picker order.
 *  `id` is what persists to localStorage. */
export const PRANK_OPTIONS: PrankOption[] = [
  {
    id: 'control-room',
    name: 'Control room',
    description:
      'People with live "playing now" rows down the left, a composer card on the right that fills in as a person is picked, the log as a table below. Everything in one screen on desktop; the regions stack on phone.',
  },
  {
    id: 'card-per-person',
    name: 'Card per person',
    description:
      'A grid of person cards, each with its now-playing line and a compact Sound / Swap / Repeat row. Tapping an action opens a sheet to compose it; the log runs as a feed under the grid.',
  },
  {
    id: 'wizard',
    name: 'Two-step wizard',
    description:
      'Pick a person first (with what they play), then a full-width composer with the sound and song library inline, then a confirm step. The log lives on its own sub-tab.',
  },
];

export const PRANK_RECOMMENDED: PrankOptionId = 'control-room';

export const PRANK_RECOMMENDED_REASON =
  'Control room: pranking someone is a five-second impulse while you are already watching who is listening to what, so the person list and the composer belong on the same screen with no click to get from one to the other. The wizard’s extra steps make sense for a rare, careful action; this one is closer to a light switch. The log as a table reads fastest when the owner is scanning for "did that land".';

/** The Liked-page-style preview states every candidate is drawn in (plan
 *  Task 0): nobody picked, someone actively listening, a repeat schedule
 *  running, and the global off switch flipped. */
export const PRANK_STATES: (PickerOption & { id: PrankStateId })[] = [
  { id: 'idle', name: 'Idle', description: 'Nobody picked yet: the composer is empty, no schedule is running.' },
  {
    id: 'listening',
    name: 'Someone listening',
    description: 'A person is picked while their music plays, so the composer previews what it would swap or play over.',
  },
  {
    id: 'repeat',
    name: 'Repeat running',
    description: 'A sound repeating every few minutes until a stop time, with Stop and a fired count.',
  },
  {
    id: 'off',
    name: 'Off switch on',
    description: 'The global switch is off: composing is disabled everywhere and the page says so.',
  },
];
