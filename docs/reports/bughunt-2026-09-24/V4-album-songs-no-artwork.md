# V4. Songs played from an album page had no artwork and no album
**Status:** fixed.
**What you'd notice:** start a song from an album page and the player bar showed a blank square instead of the cover; the song also had no album, so "go to album" and the album line were missing, and it stayed that way in your history and queue.
**Why it happened:** YouTube Music describes the songs on an album page without their own cover, and names the album only as plain text. The helper that reads albums passed the songs on like that, so the app got songs with no cover and no album.
**What changed:** the album reader now fills in each song's album name, album link and the album's cover whenever the song lacks its own (a song that has its own art keeps it). Files: `player.py` (`cmd_album`), test `tests/test_player_album_tracks.py`.
**Compare:** before = `9ae4584`, after = `e114d0a`.
- Test: `.venv/bin/python -m unittest tests/test_player_album_tracks.py` (YouTube Music replaced by an album in ytmusicapi 1.12's exact shape): fails before (`FAILED (failures=3)`, `AssertionError: None != 'Revival' : Walk On Water`, `None != 'https://lh3.googleusercontent.com/cover=w544-h544'`), passes after (`Ran 4 tests ... OK`). Full Python suite: 96 tests OK.
- Live check (anonymous, no cookies): `player.py album -- MPREb_4pL8gzRtw1p` (Revival), first song before `album: None | albumId: None | art: None`, after `album: Revival | albumId: MPREb_4pL8gzRtw1p | art: https://yt3.googleusercontent.com/...`.
- Screenshots: shots/V4-before.png vs shots/V4-after.png (player bar after starting "Walk On Water" from the Revival album page; the song's audio was stubbed out, so it shows paused).
- Try it yourself: on the sandbox, open any album, play a song: the cover shows in the player bar and Now Playing.
**Risk:** low. Only fills gaps; songs that already carried album and art are untouched.
