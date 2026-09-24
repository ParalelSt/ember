# A12. A prank sound could play during a phone call on Android
**What you'd notice:** you are on a call with music paused by the call, and a prank sound plays anyway, into the call.
**Why it happened:** the phone only started a prank sound when the music was switched to "play". During a call Android holds the music but leaves it switched to "play", and the prank sound is built never to ask Android for the speaker (so the music keeps going around it), so nothing stopped it.
**What changed:** a prank sound now also needs the music to be actually audible (not held by Android) and the phone not to be in a call. Otherwise the phone refuses it, like with paused music, and the prank is logged as skipped. Pranks over playing music work exactly as before. Files: `apps/mobile/android/.../PrankOverlay.kt`.
**Compare:** before = `026f662`, after = `818a081`.
- Test: `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.PrankOverlayCallTest'` (JDK 21; real players under Robolectric, the call is the signal Android sends when one rings). Before the fix: 2 of 4 fail.
  - `a call that rings holds the music and blocks the sound: expected:<false> but was:<null>` (the sound went ahead)
  - `the phone being in a call blocks the sound: expected:<false> but was:<null>`
  - After: 4 of 4 pass, all 118 Kotlin tests pass, `assembleDebug` builds.
- Try it yourself (needs a new APK and a second phone): install the new debug build. Play music on the phone, then call it from another phone and answer. From the computer's admin Pranks page, send that user a sound. Nothing plays in the call, and the prank shows as skipped in the log. Hang up, let the music resume, send it again: it plays.
**Risk:** low. It only adds reasons to skip a prank; a sound already playing still stops when a call rings, as before.
