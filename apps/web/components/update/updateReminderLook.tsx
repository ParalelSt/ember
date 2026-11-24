/** The update banner's look, so a newly picked design drops in without
 *  touching the behaviour in UpdateReminder.tsx: the shape, the front mark
 *  and the words here; the colours and the glow as the --update-pill-*
 *  tokens in app/globals.css (the colour lint keeps literal colours out of
 *  components), next to its slide-in keyframes.
 *
 *  Owner's picks (2026-11-13): a dark pill with a soft orange outline and a
 *  faint haze; at its front the new version in a small solid orange chip.
 *  2026-11-24: bigger and plainer so it is not missed: 15px bold "New version
 *  ready", an orange "Update" button inside it, swipe it away to hide it, at least 52px
 *  tall, full width under the top bar. The slide in is the `ember-update-in`
 *  keyframe in app/globals.css (no motion under reduced motion). */

/** The bar: edge to edge under the top bar, no rounding; its colours,
 *  outline and glow are `.ember-update-pill`. */
export const PILL_CLASS =
  'ember-update-pill pointer-events-auto flex min-h-[52px] w-full items-stretch text-[15px] font-bold leading-6 select-none';

/** The tappable part (the whole bar). */
export const ACTION_CLASS =
  'flex min-h-[52px] min-w-0 flex-1 items-center gap-cluster py-inset pl-block pr-block text-left';

/** The "Update" button inside the bar (a label: the whole area is the tap). */
export const ACTION_LABEL_CLASS =
  'ember-update-action shrink-0 rounded-full px-block py-cluster text-[15px] font-bold leading-5';

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
  /** Read out with the bar: how to put it away. */
  swipeHint: 'Swipe away to hide. Escape also hides it.',
} as const;
