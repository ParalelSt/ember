"""player.py `album`: every song carries its album and cover (bughunt V4).

ytmusicapi's get_album gives each track the album only as a plain title
string and no thumbnails of its own, so a song played from an album page
showed no artwork and no album. The album shape below is ytmusicapi 1.12's
(see its get_album docstring). No network: YTMusic is replaced.

    .venv/bin/python -m unittest tests/test_player_album_tracks.py
"""
import argparse
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-album-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402

BROWSE_ID = "MPREb_4pL8gzRtw1p"
COVER_SMALL = "https://lh3.googleusercontent.com/cover=w60-h60"
COVER_LARGE = "https://lh3.googleusercontent.com/cover=w544-h544"
ARTIST = {"name": "Eminem", "id": "UCedvOgsKFzcK3hA5taf3KoQ"}


def album_track(video_id, title, **over):
    track = {
        "videoId": video_id,
        "title": title,
        "artists": [ARTIST],
        "album": "Revival",  # get_album sets the album title, a string
        "likeStatus": "INDIFFERENT",
        "thumbnails": None,  # album tracks come without their own art
        "isAvailable": True,
        "isExplicit": True,
        "duration": "5:03",
        "duration_seconds": 303,
        "trackNumber": 1,
    }
    track.update(over)
    return track


ALBUM = {
    "title": "Revival",
    "type": "Album",
    "thumbnails": [{"url": COVER_SMALL, "width": 60, "height": 60}, {"url": COVER_LARGE, "width": 544, "height": 544}],
    "artists": [ARTIST],
    "year": "2017",
    "trackCount": 3,
    "duration_seconds": 700,
    "audioPlaylistId": "OLAK5uy_nMr9h2VlS-2PULNz3M3XVXQj_P3C2bqaY",
    "tracks": [
        album_track("iY9jP_rFcSU", "Walk On Water"),
        album_track("5v0kQaDmI1c", "Believe", trackNumber=2),
        # A song that does carry art of its own keeps it.
        album_track("aXk3m9b1HEo", "Chloraseptic", trackNumber=3,
                    thumbnails=[{"url": "https://i.ytimg.com/vi/aXk3m9b1HEo/own.jpg", "width": 120, "height": 90}]),
        # Nothing playable: dropped, as before.
        album_track(None, "Untouchable (unavailable)", isAvailable=False),
    ],
}


def run_album(album):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(player, "yt") as yt:
        yt.get_album.return_value = album
        with redirect_stdout(out), redirect_stderr(err):
            player.cmd_album(argparse.Namespace(browse_id=BROWSE_ID))
    return json.loads(out.getvalue())


class AlbumTracksTest(unittest.TestCase):
    def test_every_song_has_the_album_and_its_id(self):
        res = run_album(ALBUM)
        self.assertEqual([t["title"] for t in res["tracks"]], ["Walk On Water", "Believe", "Chloraseptic"])
        for t in res["tracks"]:
            self.assertEqual(t["album"], "Revival", t["title"])
            self.assertEqual(t["albumId"], BROWSE_ID, t["title"])

    def test_songs_without_art_get_the_album_cover(self):
        res = run_album(ALBUM)
        art = {t["title"]: t["artworkUrl"] for t in res["tracks"]}
        self.assertEqual(art["Walk On Water"], COVER_LARGE)
        self.assertEqual(art["Believe"], COVER_LARGE)
        self.assertEqual(art["Chloraseptic"], "https://i.ytimg.com/vi/aXk3m9b1HEo/own.jpg")

    def test_the_songs_own_artist_is_kept(self):
        res = run_album(ALBUM)
        self.assertEqual({t["artist"] for t in res["tracks"]}, {"Eminem"})
        self.assertEqual({t["artistId"] for t in res["tracks"]}, {ARTIST["id"]})

    def test_an_album_without_a_cover_still_loads(self):
        res = run_album({**ALBUM, "thumbnails": []})
        self.assertIsNone(res["tracks"][0]["artworkUrl"])
        self.assertEqual(res["tracks"][0]["album"], "Revival")


if __name__ == "__main__":
    unittest.main()
