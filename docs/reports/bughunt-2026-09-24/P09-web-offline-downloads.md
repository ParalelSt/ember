# P09. Playlist downloads in the browser and desktop app did nothing for playback

**What you'd notice:** in a browser or the desktop app, "Download playlist" said "Downloaded", but with the internet off the songs still would not play. A playlist containing one of your uploaded songs always said "Couldn't download", and a single bad song threw away every song already saved.

**Why it happened:** the download saved files into the browser's private storage, but the player never looked there (only the Android app's downloads were wired up). The download also asked the YouTube route for every song, which has no idea about uploads, and any one failure deleted the whole download.

**What changed:** each saved file now gets a local address the player uses, online or off (Android is untouched). Songs are fetched from their own address, so uploads work. A failing song is skipped and counted: "Downloaded "Mix", 3 of 40 couldn't be saved". The desktop app's own audio engine can't read browser storage, so it keeps streaming while online; offline it switches to the browser's audio for the session and plays the downloaded copy (media keys are lost until restart). Files: `apps/web/lib/offline.ts`, `apps/web/components/player/PlayerProvider.tsx`, `apps/web/stores/useOfflineStore.ts`, `apps/web/hooks/useOfflinePin.ts`.

**Compare:** before = `1a74577`, after = `d4fe144`.
- Test: `cd apps/web && npx vitest run lib/offline.test.ts components/player/PlayerProvider.offline.test.tsx hooks/useOfflinePin.test.ts`: before, 9 of 14 fail (`Error: Audio fetch 500 for Song B`; the player got the stream URL instead of the `blob:` copy). After, 14/14 pass. Full unit suite 2695/2695.
- Browser: `node tests/offline-web-ui.test.mjs` (app 3053, PB 8086; two uploads plus one missing song, Download, go offline, play). Before: 0/5 (`Couldn't download "Offline Mix"`, `error=4`). After: 5/5 (`Downloaded "Offline Mix", 1 of 3 couldn't be saved`, `blob:` source, playing at 1.2 s).
- Android check still passes: `tests/offline-android-ui.test.mjs` 20/20, `tests/offline-page.test.mjs` 35/35.
- Screenshots: shots/P09-before.png vs shots/P09-after.png (the download message).
- Try it yourself: in Chrome, open a playlist with an uploaded song, press Download, turn Wi-Fi off, and play a song from it.

**Risk:** medium. It changes how the web player chooses a source, but it only differs when a browser download exists. Not tried inside the real desktop app; the switch there is covered by unit tests only.
