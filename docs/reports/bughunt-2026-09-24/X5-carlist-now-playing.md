# X5. Starting a carlist with music already queued broke "Now playing" and Skip for guests

**What you'd notice:** you start a carlist while your own playlist is queued. Guests see the wrong song under "Now playing" (or none), their songs only play after all your leftovers, and their Skip skips your songs.

**Why it happened:** the host told guests "I'm on song number N of MY player queue", but guests read N as a row of the carlist. With your own songs in front, the two lists never lined up. The group's songs were also added after your leftovers.

**What changed:** two small changes. (1) Starting a carlist keeps the song that is playing but drops the rest of your old queue, so the group's songs come next. (2) The host now says which carlist row is playing (it looks the playing song up in the carlist) instead of its own position, and says nothing while a song from outside the carlist plays. Files: `hooks/useSessionHost.ts`, `components/session/SessionDialogs.tsx`.

**Why this choice:** sending the row's id would need a new database field for the same result; the row number already works for guests once it is a carlist row. Swapping the whole queue at start would cut off the song you were listening to. The look-up also keeps guests right if you play something else mid-carlist.

**Compare:** before = `e0b6025`, after = `9612f56`.
- Test: `cd apps/web && npx vitest run hooks/useSessionHost.test.tsx`: fails before (5 of the 5 new tests), passes after (11 of 11).
  - `× publishes the session row of the playing song, not the player index` / `expected last "vi.fn()" call to have been called with [ 's1', +0 ]`
  - `× drops the leftover queue at start but keeps the playing song` / `TypeError: startHosting is not a function`
- Try it yourself: on the sandbox, queue a playlist and play its 3rd song. Start a carlist seeded with another playlist, join it from a second account. The guest sees the carlist's first song once your current song ends, and Skip moves both screens together.

**Risk:** low. Known leftover: while the song you were already playing finishes, guests see carlist row 1 as "Now playing".
