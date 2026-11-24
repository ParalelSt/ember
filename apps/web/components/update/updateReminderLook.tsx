/** The update banner's look, so a newly picked design drops in without
 *  touching the behaviour in UpdateReminder.tsx: the shape, the front mark
 *  and the words here; the colours and the glow as the --update-pill-*
 *  tokens in app/globals.css (the colour lint keeps literal colours out of
 *  components), next to its slide-in keyframes.
 *
 *  Owner's picks (2026-11-13): a dark pill with a soft orange outline and a
 *  faint haze; at its front the new version in a small solid orange chip.
 *  2026-11-24: bigger and plainer so it is not missed: 15px bold "New version
 *  ready", an orange "Update" button inside it, a close button, at least 44px
 *  tall. The slide in and out are the `ember-update-in` / `ember-update-out`
 *  keyframes in app/globals.css (no motion under reduced motion). */

/** The banner: its colours, outline and glow are `.ember-update-pill`. */
export const PILL_CLASS =
  'ember-update-pill pointer-events-auto flex min-h-[48px] w-full max-w-[min(26rem,calc(100vw-2rem))] items-stretch rounded-full text-[15px] font-bold leading-6';

/** The tappable part (everything but the close button). */
export const ACTION_CLASS =
  'flex min-h-[48px] min-w-0 flex-1 items-center gap-cluster rounded-full py-inset pl-cluster pr-inset text-left';

/** The "Update" button inside the banner (a label: the whole area is the tap). */
export const ACTION_LABEL_CLASS =
  'ember-update-action shrink-0 rounded-full px-row py-inset text-[15px] font-bold leading-5';

/** The close button: a 44px tap target. */
export const CLOSE_CLASS =
  'ember-update-close flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full';

/** The front mark: the new version in a small solid orange chip. */
export function ReminderMark({ version }: { version: string }) {
  return (
    <span
      data-testid="update-reminder-chip"
      className="ember-update-chip shrink-0 rounded-full px-cluster text-[11px] font-bold leading-[20px] tabular-nums"
    >
      {version}
    </span>
  );
}

/** Every line the banner can say. The version is already in the chip. */
export const REMINDER_WORDING = {
  ready: 'New version ready',
  /** The action button next to it. */
  action: 'Update',
  /** The action button after a failed try. */
  retry: 'Retry',
  /** Tapped while offline: it goes in once the host answers again. */
  waitingOnline: 'Updating once back online',
  /** Going in now (the page reloads, the app downloads and installs). */
  applying: 'Updating',
  /** A desktop app from before 0.4.27 cannot install on a tap: its launch
   *  dialog installs the update at the next start. */
  reopen: 'Quit and reopen Ember to update',
  /** The app could not download or install it; a tap tries again. */
  failed: "Couldn't update",
  /** The close button's name. */
  dismiss: 'Not now',
} as const;
