# Discord showed the previous song's time after a skip

**What you'd notice:** a song is playing at 2:45 and you skip it. Discord shows the new song's title, but its time bar keeps going from 2:45 as if the new song had been playing that long. It stayed wrong until you paused or seeked.

## Cause

The card's time is worked out as "now minus where the playhead is" (on the desktop in `discord.rs`, on the server in `lib/discord.ts`). Both were doing that correctly. The wrong number came from the web side, in `hooks/player/useDiscordPresence.ts`:

1. When the song changed, the hook sent whatever playhead the player held **at that moment** and assumed it belonged to the new song. It only does when the web player loads the song itself (Next, Previous, a tap), because those reset the playhead to 0 in the same step. Other changes swap the song first and fix the playhead a moment later: a change the player loads from its own effect (for example, the playing song removed from the queue), and a change the native Android player reports (notification, lock screen, car). For those, Discord was sent the new song with the old 2:45, and the old song's length.
2. Nothing corrected it afterwards. The hook compared each playhead tick with the previous one to spot seeks, but that "previous tick" still belonged to the old song. So the new song's first tick (0:00) looked like "a different song, not a seek", and nothing was sent. The card stayed at 2:45 for the whole song.

Proof, from the provider test with the real hook, before the fix: the payload for the new song was `['Second', true, 165, 200]` (2:45, and the previous song's 200 s length) instead of `['Second', true, 0, 240]`. No later update was sent.

This is not the P11 bug (that one saved the old time as the new song's resume spot). The player does reset the stored playhead when it loads a song (P11 made that reset complete), but for the changes above the presence hook read the playhead before the reset reached it, so it had its own stale path.

**A second, smaller problem on the desktop:** Discord only accepts an update about every 15 s, so the desktop holds a same-song update (a seek, say) until the window ends. When it finally sent it, it worked out the start time from the moment of sending, not the moment the update arrived. A seek made 5 s after a skip waited 10 s, then showed up on the card 10 s behind, and stayed that way.

## Fix

- `apps/web/hooks/player/useDiscordPresence.ts`: when the song changes from one song to another, the card gets **0:00 and the new song's own length**. A new song always starts at the top in this player (`lib/playback/resumePosition.ts`), so this is the same rule the player uses. The seek check now starts from that 0:00, so the new song's first ticks are not mistaken for anything. A leftover tick from the old song (the desktop engine can have one in flight) is ignored, and seeks, pause and resume work as before. A cold start (no song before) still resumes at the saved spot.
- `apps/desktop/src-tauri/src/discord.rs`: each update remembers when it arrived, and the start time is worked out from that, so a held-back update lands with the right time.

## Tests

- `apps/web/hooks/player/useDiscordPresence.test.ts`: skip at 2:45 sends 0:00 and the new song's length; stays at 0:00 as the new song ticks; ignores a late old-song tick; seek, pause and resume after a skip; skip while paused; cold start. 4 of these failed before the fix.
- `apps/web/components/player/PlayerProvider.discord.test.tsx`: the real provider, hook and publish call. Next at 2:45, a change the player loads itself, a late old-song tick, then seek, pause and resume in the new song. 2 failed before the fix.
- `apps/desktop/src-tauri/src/discord.rs` tests: a new song at 0 starts now; a seek; a held-back update keeps its arrival time (failed before, 15 s off); no length means no end time.
- Full runs: `npm run test:unit` 3207/3207, `npx tsc --noEmit` clean, `cargo test --lib` 121 passed.

## How to check in Discord

1. Turn on "Show what I'm playing on Discord" in Ember's settings (Privacy), with Discord open on the same computer.
2. Play a song and let it reach 2:00 or so. Check your Discord profile: the bar shows about 2:00.
3. Press Next. The card should switch to the new song at 0:00 straight away.
4. Also try removing the playing song from its playlist, or skipping from the phone's notification (web presence shows on the host's Discord). Both should show 0:00.
5. Seek to 1:00 a few seconds after skipping. Within 15 s the card should show about 1:00 plus the seconds since, not 15 s less.

The main fix is web only: it reaches everyone with the next web update. The desktop part (held-back updates) needs a new desktop build.
