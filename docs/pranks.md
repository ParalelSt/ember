# Pranks

An admin-only feature. From `/admin/pranks` (the "Control room" in the admin
pages) an admin can play a sound effect into a friend's app while they are
listening to music. There is no opt-out and the target is never told a prank
happened; only the admin log records it.

## What an admin can do

- **Send a sound.** Pick a person, pick a sound from the library, and choose
  whether it plays *over* their music (at full volume, on top of it) or
  *under* it (the music ducks to 30% while the sound plays, then comes back).
- **Manage the library.** Upload, rename and delete the sound files admins can
  send. Uploads are hinted toward mp3/m4a.
- **Repeat it.** Schedule a sound to fire on a person on a fixed interval
  until a stop time, instead of sending it once by hand.
- **Stop.** Stop one person's running repeat, or "Stop everything" to cancel
  every repeat and every prank still waiting to be delivered.
- **The global switch.** Turn pranks off for everyone at once (also settable
  with `PRANKS_ENABLED=0`, which forces it off regardless of the stored
  setting).
- **The log.** Every prank ever sent, in plain words: who sent it, to whom,
  what happened (delivered, done, skipped and why, or expired), and when.

Nothing here is shown to the person being pranked. A sound only ever plays
while their music is actually playing; nothing fires while they are paused
or idle.

## Limits

The real numbers, from `apps/web/lib/pranks/limits.ts`:

- A sound plays for at most **30 s**.
- Music ducks to **30%** under a sound (`mode: duck`).
- A prank not acknowledged within **45 s** reads as expired.
- At most **20 pranks per target per hour**, and at most **60 per admin per
  hour** (every kind counts against the admin's own cap; pings don't count
  against a target's).
- At least **15 s** between two sounds sent to the same person.
- A repeat's interval is between **60 s and 2 hours**, spanning at most
  **2 hours** end to end, with at most **3 active repeats per target**.

## Which apps support it

- **Web** and **desktop** (through the desktop app's webview overlay): full
  support.
- **Android**, from the APK built after this feature landed: full support.
- An **older Android APK** cannot play a prank sound; its app acknowledges
  the prank as received but logs "their app cannot do that yet" instead of
  playing it.

## How delivery works

A target's app polls for pending pranks: every **2.5 s** while music is
playing, every **10 s** otherwise. Setting `NEXT_PUBLIC_PRANKS_REALTIME=1`
switches this to a PocketBase realtime subscription instead of polling, but
only works on a host that serves `/pb` uncompressed (a compressing proxy in
front of PocketBase breaks the realtime SSE stream), so it is opt-in and off
by default.

A device where nothing is playing never answers for a sound: it leaves the
prank pending, so another of the person's devices that is playing can take
it (or this one, if music starts inside the 45 s window). If none does, the
prank expires.

## Server-side env settings

- `PRANK_TICK_DISABLED=1` turns off the background tick that turns a due
  repeat into a one-off prank (the repeats themselves are unaffected; they
  simply stop firing until the tick runs again).
- `PRANK_TICK_INTERVAL_MS` sets how often that tick runs (default 5000).
