/** The "new design" intro pop-up: which steps it has and whether this device
 *  has seen it. */

/** Step 4 ("Prefer the old look?") points at the Classic look switch in
 *  Settings > Appearance (components/settings/appearance/ClassicLookRow). */
export const CLASSIC_LAYOUT_AVAILABLE = true;

export const INTRO_SEEN_KEY = 'ember.intro.redesign.v1';

export type IntroStepId = 'new' | 'swipe' | 'tour' | 'classic' | 'fix';

/** The steps, in order. Swipe is phone-only. */
export function introSteps(opts: { desktop: boolean; classic?: boolean }): IntroStepId[] {
  const classic = opts.classic ?? CLASSIC_LAYOUT_AVAILABLE;
  const steps: IntroStepId[] = ['new'];
  if (!opts.desktop) steps.push('swipe');
  steps.push('tour');
  if (classic) steps.push('classic');
  steps.push('fix');
  return steps;
}

export function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    // No storage (private window): treat as seen rather than nag every open.
    return true;
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    /* nothing to remember it in */
  }
}

/** Pages the intro never opens over. */
export function introBlockedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return ['/auth', '/link', '/privacy', '/terms'].some((p) => pathname === p || pathname.startsWith(p + '/'));
}
