# N8. Voice search gave up during the first-time permission prompts

**What you'd notice:** The first time you tap the mic in the desktop app, the system asks for microphone and speech permission (macOS asks twice). If you take more than about 15 seconds to read and answer them, the mic quietly gives up before it ever listens, and you have to tap again.

**Why it happened:** The 15-second "stop listening" limit started counting the moment you tapped, while the permission dialogs were still on screen, not when listening actually began.

**What changed:** The 15-second limit now starts once listening really begins. While the dialogs are up, a separate 90-second limit (the same one the desktop app already uses) still makes sure a mic that never answers doesn't stay "listening" forever. Files: `apps/web/lib/speech/session.ts`.

**Compare:** before = `5720e00`, after = `b84d160`.
- Test: `cd apps/web && npx vitest run lib/speech/session.test.ts`: fails before:
  `gives the first-time permission prompts all the time they take: expected "vi.fn()" to not be called at all, but actually been called 1 times` (the mic was stopped at 15 s, mid-prompt)
  Passes after (11/11), including a new check that a start that never answers is still given up at 90 s.
- Screenshots: not visual.
- Try it yourself: needs a real Mac with the desktop app and speech permission reset (`tccutil reset SpeechRecognition` and `tccutil reset Microphone`), then tap the mic and wait 20 s before answering the dialogs.

**Risk:** low. In the browser, listening starts right away, so nothing changes there; the Android app gets the same extra time if its start waits for the permission dialog.
