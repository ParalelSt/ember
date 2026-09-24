# N1. A colour edit made just before leaving Appearance could vanish

**What you'd notice:** drag a colour in Settings > Appearance, then immediately click away (close the tab, hit back, navigate elsewhere) within about half a second. The edit never saves: it looks fine on screen for a moment, then is gone next time you open Appearance.

**Why it happened:** colour edits wait 0.6 seconds after your last drag before saving, so a picker firing on every step doesn't spam the server. Leaving the page normally sends that save right away instead of waiting, but closing the tab or navigating away skipped that step entirely: the page just cleared its waiting timer and threw the edit away.

**What changed:** the pending save is now sent immediately when the component is removed from the page, and also when the browser fires "pagehide" (which covers closing the tab, navigating away, and backgrounding on mobile). Files: `apps/web/hooks/useThemeEditor.ts` (a new effect flushes on unmount and on pagehide).

**Compare:** before = `354716b`, after = `4ad3bb4`.
- Test: `npx vitest run hooks/useThemeEditor.test.tsx`: both N1 cases fail before this fix (`expected "vi.fn()" to be called 1 times, but got 0 times` for both unmount and pagehide), pass after (`Tests 2 passed (2)`).
- Screenshots: none, not visual (a save either lands on the server or doesn't).
- Try it yourself: on Settings > Appearance, drag a colour slider once, then immediately press the browser back button. Come back to Appearance: the colour should have kept your change.
**Risk:** low, additive (an extra flush point); the flush logic itself already existed and is exercised elsewhere.

**Changed by F1 (owner's request):** Appearance no longer saves anything by itself. A colour edit (or a pick) now shows only in the page's preview until you press Apply, so there is no waiting save left to flush: the unmount and pagehide flush is gone, and leaving the page applies and saves nothing. The edit is not lost either: it stays in memory for the session, and coming back to Appearance shows it again with Apply. The two N1 tests in `apps/web/hooks/useThemeEditor.test.tsx` now check exactly that (unmount and pagehide send nothing; remounting shows the same draft with Apply on). See `F1-theme-apply-button.md`.
- Try it yourself now: change a colour in Settings > Appearance, press back, then open Appearance again: the change is still in the preview with Apply, and the rest of the app never changed.
