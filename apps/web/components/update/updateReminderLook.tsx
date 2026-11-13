import type { CSSProperties } from 'react';

/** The update reminder's look, all in one place, so a newly picked design
 *  drops in here without touching the behaviour in UpdateReminder.tsx.
 *
 *  Owner's picks (2026-11-13): a dark pill with a soft orange outline and a
 *  faint haze; at its front the new version in a small solid orange chip;
 *  then "New version" in bold. After a tap while a song plays: "Updating
 *  after this song". The slide in and out are the `ember-update-in` /
 *  `ember-update-out` keyframes in app/globals.css (no motion under
 *  reduced motion). */

/** The pill: colours, outline and glow. */
export const PILL_STYLE: CSSProperties = {
  background: '#141d23',
  color: '#f4efe9',
  boxShadow: '0 0 0 1.5px #ff8a3d, 0 0 8px rgba(255,138,61,.22)',
};
export const PILL_CLASS =
  'pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-[13px] font-bold leading-5';

/** The front mark: the new version in a small solid orange chip. */
export function ReminderMark({ version }: { version: string }) {
  return (
    <span
      data-testid="update-reminder-chip"
      className="shrink-0 rounded-full px-2 text-[10.5px] font-bold leading-[18px] tabular-nums"
      style={{ background: '#ff8a3d', color: '#0b1216' }}
    >
      {version}
    </span>
  );
}

/** Every line the pill can say. The version is already in the chip. */
export const REMINDER_WORDING = {
  ready: 'New version',
  /** Tapped while a song plays. */
  waiting: 'Updating after this song',
  /** Tapped while offline: it goes in once the host answers again. */
  waitingOnline: 'Updating once back online',
  /** Going in now (the page reloads, the app restarts). */
  applying: 'Updating',
  /** A desktop app that cannot restart itself: its launch dialog installs
   *  the update at the next start. */
  reopen: 'Quit and reopen Ember to update',
  /** The Android app could not download or install it; a tap tries again. */
  failed: "Couldn't update",
} as const;
