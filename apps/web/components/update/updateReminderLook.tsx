/** The update reminder's look, so a newly picked design drops in without
 *  touching the behaviour in UpdateReminder.tsx: the shape, the front mark
 *  and the words here; the colours and the glow as the --update-pill-*
 *  tokens in app/globals.css (the colour lint keeps literal colours out of
 *  components), next to its slide-in keyframes.
 *
 *  Owner's picks (2026-11-13): a dark pill with a soft orange outline and a
 *  faint haze; at its front the new version in a small solid orange chip;
 *  then "New version" in bold. After a tap while a song plays: "Updating
 *  after this song". The slide in and out are the `ember-update-in` /
 *  `ember-update-out` keyframes in app/globals.css (no motion under
 *  reduced motion). */

/** The pill: its colours, outline and glow are `.ember-update-pill`. */
export const PILL_CLASS =
  'ember-update-pill pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-cluster rounded-full py-inset pl-inset pr-row text-[13px] font-bold leading-6';

/** The front mark: the new version in a small solid orange chip. */
export function ReminderMark({ version }: { version: string }) {
  return (
    <span
      data-testid="update-reminder-chip"
      className="ember-update-chip shrink-0 rounded-full px-cluster text-[10.5px] font-bold leading-[18px] tabular-nums"
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
