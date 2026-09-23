# P04. Stale radio results get added to the wrong queue

**What you'd notice:** you tap away from a song to play something else, and a moment later a track shows up in your queue that has nothing to do with what you're listening to now.

**Why it happened:** when a song reaches the end of the queue, Ember asks the server for similar songs to keep playing. If you switch to a different song before that request comes back, the old response still lands and gets tacked onto your new queue, even though it was for the song you already left.

**What changed:** the radio fetch now checks, right before adding anything, that you're still on the same track and the same queue it was fetched for. If not, it quietly throws the response away. Files: `apps/web/hooks/player/useRadioExtend.ts` (guard added), `apps/web/hooks/player/useRadioExtend.test.ts` (new test).

**Compare:** before = `405ab61`, after = `21bd7172266e25b6c0341923b7afe8c2c0c7006c`.
- Test: `npx vitest run hooks/player/useRadioExtend.test.ts -t "already left"`: before, the queue gained `youtube:stale` and the logger recorded `extend` instead of `stale-skip` (assertion failed, timed out waiting for `stale-skip`); after, all 10 tests in the file pass.
- Screenshots: not visual.
- Try it yourself: play a song, let it near the end of the queue so radio is fetching, then immediately search and play a different song. Watch the queue: no leftover track from the song you left.

**Risk:** low, the change only adds a bail-out check before an existing queue write.
