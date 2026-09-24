# O7. "Download for offline" oversold what the browser and desktop app can do

**What you'd notice:** on the web or the desktop app, the download button
and the Downloads settings page both said the playlist was saved "for
offline playback", same wording as the real Android downloads. In practice a
reload of the page, or launching fully offline, loses it: nothing loads the
app itself without an internet connection first.

**Why it happened:** the browser/desktop download only saves the audio
files into that page's own storage, readable only while Ember stays open in
that tab. There is no service worker caching the app's HTML/JS, so the app
shell can't even start without the network. The Android app is different: it
is a native shell that always starts, so its downloads really are "offline".
The button and settings text never distinguished the two.

**What changed:** the download button and the Downloads settings page now
say "Plays offline while Ember stays open in this tab" on web/desktop, and
keep the original "saved ... offline playback" wording only on Android
(native). Files: `components/library/DownloadButton.tsx`,
`hooks/useOfflinePin.ts`, `app/(app)/settings/downloads/page.tsx`.

**The bigger fix, not done here:** a real service worker that caches the app
shell would let the page itself load offline (after a reload or a cold
start), closing this gap for good. That's a larger, separate change
(`apps/web/public/sw.js` already exists as a dormant kill switch,
`components/RegisterSW.tsx`); this fix only makes today's wording truthful.

**Compare:** before = `a1ddcac`, after = `fe2d4ae`.
- Test: `cd apps/web && npx vitest run components/library/DownloadButton.test.tsx hooks/useOfflinePin.test.ts`: the new "honest about the tab" check fails before (`title="Save this collection for offline playback"` instead of the tab wording), 4/4 pass after.
- Try it yourself: on the sandbox web app, open Settings > Downloads, or hover a playlist's Download button; the tooltip and page text now say "Plays offline while Ember stays open in this tab" instead of implying it survives a reload.

**Risk:** low. Text-only change, gated on the existing native/web check that already drives every other download-path difference.
