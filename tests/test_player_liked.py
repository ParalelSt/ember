"""player.py liked: reading the caller's own YouTube Music likes.

    .venv/bin/python -m unittest tests/test_player_liked.py

No network and no account: `YTMusic` and `ytmusicapi.setup` are replaced with
stubs, so what is checked is the command's own behaviour. The last class is
the one that matters most: the pasted headers are somebody's Google session,
so they must not reach stdout or stderr on any path, including a library
that puts the whole request into its exception message.
"""
import argparse
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# player.py creates MUSIC_DIR on import; keep that out of the repo.
os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-liked-test-")
sys.path.insert(0, str(ROOT))
import player  # noqa: E402

# A paste shaped like the real thing: the Cookie line is the secret, the rest
# is what ytmusicapi asks for. Every value here is invented.
SECRET_COOKIE = "SAPISID=s3cr3tSAPISIDvalue; __Secure-3PAPISID=s3cr3t3PAPISIDvalue; SID=s3cr3tSIDvalue"
HEADERS = (
    "accept: */*\n"
    "authorization: SAPISIDHASH 1758500000_s3cr3thashvalue\n"
    f"cookie: {SECRET_COOKIE}\n"
    "user-agent: Mozilla/5.0\n"
    "x-goog-authuser: 0\n"
)
# The pieces that must never be echoed back.
SECRET_PARTS = ["s3cr3tSAPISIDvalue", "s3cr3t3PAPISIDvalue", "s3cr3tSIDvalue", "s3cr3thashvalue", SECRET_COOKIE]


def song(video_id, title, artists=("Artist",), **extra):
    t = {
        "videoId": video_id,
        "title": title,
        "artists": [{"name": a, "id": f"UC{a}"} for a in artists],
        "album": {"name": "An Album", "id": "MPREb1"},
        "duration": "3:22",
        "duration_seconds": 202,
        "thumbnails": [{"url": "https://lh3.example/small"}, {"url": "https://lh3.example/large"}],
        "setVideoId": f"set-{video_id}",
        "videoType": "MUSIC_VIDEO_TYPE_ATV",
        "isAvailable": True,
    }
    t.update(extra)
    return t


class StubYTMusic:
    """Stands in for an authenticated YTMusic. Records what it was built with
    so a test can prove the headers went in as they came, and nothing else."""

    built_with = []
    error = None
    tracks = []

    def __init__(self, auth=None, **kwargs):
        StubYTMusic.built_with.append(auth)

    def get_liked_songs(self, limit=100):
        StubYTMusic.limits.append(limit)
        if StubYTMusic.error:
            raise StubYTMusic.error
        return {"title": "Liked Music", "tracks": StubYTMusic.tracks[:limit]}


StubYTMusic.limits = []


class LikedTestCase(unittest.TestCase):
    """Shared plumbing: stub ytmusicapi, feed stdin, capture both streams."""

    def setUp(self):
        self.real_ytmusic = player.YTMusic
        self.real_setup = player.ytmusicapi_setup
        self.setup_calls = []
        StubYTMusic.built_with, StubYTMusic.limits = [], []
        StubYTMusic.error, StubYTMusic.tracks = None, []
        player.YTMusic = StubYTMusic
        player.ytmusicapi_setup = self.fake_setup

    def tearDown(self):
        player.YTMusic = self.real_ytmusic
        player.ytmusicapi_setup = self.real_setup

    def fake_setup(self, filepath=None, headers_raw=None):
        self.setup_calls.append({"filepath": filepath, "headers_raw": headers_raw})
        return json.dumps({"cookie": "parsed", "x-goog-authuser": "0"})

    def run_liked(self, stdin=HEADERS, auth_stdin=True):
        """cmd_liked with stdin, returning (parsed stdout, raw stdout, stderr)."""
        out, err = io.StringIO(), io.StringIO()
        real_stdin = sys.stdin
        sys.stdin = io.StringIO(stdin)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                player.cmd_liked(argparse.Namespace(auth_stdin=auth_stdin))
        finally:
            sys.stdin = real_stdin
        return json.loads(out.getvalue()), out.getvalue(), err.getvalue()


class LikedHappyPathTest(LikedTestCase):
    def test_prints_the_liked_songs_in_order(self):
        StubYTMusic.tracks = [song("aaaaaaaaaaa", "First"), song("bbbbbbbbbbb", "Second"), song("ccccccccccc", "Third")]
        payload, _, err = self.run_liked()
        self.assertEqual(payload["count"], 3)
        self.assertFalse(payload["truncated"])
        self.assertEqual([i["videoId"] for i in payload["items"]], ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"])
        self.assertEqual(err, "")

    def test_one_item_carries_what_the_transfer_needs(self):
        StubYTMusic.tracks = [song("aaaaaaaaaaa", "First", artists=("Bjork", "Guest"))]
        payload, _, _ = self.run_liked()
        item = payload["items"][0]
        self.assertEqual(item["title"], "First")
        self.assertEqual(item["artists"], ["Bjork", "Guest"])
        self.assertEqual(item["album"], "An Album")
        self.assertEqual(item["durationSec"], 202)
        self.assertEqual(item["artworkUrl"], "https://lh3.example/large")
        self.assertEqual(item["videoType"], "ATV")
        self.assertEqual(item["setVideoId"], "set-aaaaaaaaaaa")
        # YouTube Music does not date its likes, so the order is all there is.
        self.assertIsNone(item["likedAt"])

    def test_duration_falls_back_to_the_printed_length(self):
        StubYTMusic.tracks = [song("aaaaaaaaaaa", "First", duration_seconds=None, duration="4:05")]
        payload, _, _ = self.run_liked()
        self.assertEqual(payload["items"][0]["durationSec"], 245)

    def test_drops_rows_with_no_video_and_songs_blocked_here(self):
        StubYTMusic.tracks = [
            song("aaaaaaaaaaa", "Playable"),
            song(None, "No video at all"),
            song("ddddddddddd", "Blocked", isAvailable=False),
        ]
        payload, _, _ = self.run_liked()
        self.assertEqual([i["videoId"] for i in payload["items"]], ["aaaaaaaaaaa"])
        self.assertEqual(payload["count"], 1)

    def test_the_headers_reach_ytmusicapi_and_no_file(self):
        StubYTMusic.tracks = [song("aaaaaaaaaaa", "First")]
        self.run_liked()
        self.assertEqual(len(self.setup_calls), 1)
        self.assertEqual(self.setup_calls[0]["headers_raw"], HEADERS)
        # filepath None is what keeps browser.json from ever being written.
        self.assertIsNone(self.setup_calls[0]["filepath"])
        self.assertEqual(StubYTMusic.built_with, ['{"cookie": "parsed", "x-goog-authuser": "0"}'])


class LikedPaginationTest(LikedTestCase):
    def test_asks_for_the_whole_list_one_over_the_cap(self):
        StubYTMusic.tracks = [song(f"vid{i:08d}", f"Song {i}") for i in range(20)]
        self.run_liked()
        # ytmusicapi follows the continuations itself; asking for one more
        # than a transfer may carry is how truncation is noticed.
        self.assertEqual(StubYTMusic.limits, [player.LIKED_MAX_ITEMS + 1])

    def test_a_library_over_the_cap_is_cut_and_says_so(self):
        StubYTMusic.tracks = [song(f"vid{i:08d}", f"Song {i}") for i in range(player.LIKED_MAX_ITEMS + 5)]
        payload, _, _ = self.run_liked()
        self.assertTrue(payload["truncated"])
        self.assertEqual(payload["count"], player.LIKED_MAX_ITEMS)
        self.assertEqual(len(payload["items"]), player.LIKED_MAX_ITEMS)

    def test_a_library_exactly_at_the_cap_is_not_truncated(self):
        StubYTMusic.tracks = [song(f"vid{i:08d}", f"Song {i}") for i in range(player.LIKED_MAX_ITEMS)]
        payload, _, _ = self.run_liked()
        self.assertFalse(payload["truncated"])
        self.assertEqual(payload["count"], player.LIKED_MAX_ITEMS)

    def test_an_empty_library_is_an_empty_list_not_an_error(self):
        payload, _, _ = self.run_liked()
        self.assertEqual(payload, {"items": [], "count": 0, "truncated": False})


class LikedFailureTest(LikedTestCase):
    def test_stale_headers_are_an_auth_error_in_one_sentence(self):
        from ytmusicapi.exceptions import YTMusicUserError

        StubYTMusic.error = YTMusicUserError("Please provide authentication before using this function")
        payload, _, err = self.run_liked()
        self.assertEqual(payload["kind"], "auth")
        self.assertIn("music.youtube.com", payload["error"])
        self.assertNotIn("Traceback", err)

    def test_a_401_is_an_auth_error_too(self):
        StubYTMusic.error = RuntimeError("Server returned HTTP 401: Unauthorized")
        payload, _, _ = self.run_liked()
        self.assertEqual(payload["kind"], "auth")

    def test_youtube_being_down_is_a_network_error(self):
        StubYTMusic.error = RuntimeError("HTTP 503: Service Unavailable")
        payload, _, _ = self.run_liked()
        self.assertEqual(payload["kind"], "network")
        self.assertEqual(payload["error"], player.LIKED_ERRORS["network"])

    def test_an_unreadable_answer_is_a_parse_error(self):
        StubYTMusic.error = KeyError("musicShelfRenderer")
        payload, _, _ = self.run_liked()
        self.assertEqual(payload["kind"], "parse")

    def test_a_paste_with_no_cookie_line_says_what_is_missing(self):
        payload, _, _ = self.run_liked(stdin="accept: */*\nx-goog-authuser: 0\n")
        self.assertEqual(payload["kind"], "auth")
        self.assertIn("cookie", payload["error"])
        # Nothing was tried against YouTube Music.
        self.assertEqual(StubYTMusic.built_with, [])

    def test_a_signed_out_cookie_line_is_refused_before_the_call(self):
        payload, _, _ = self.run_liked(stdin="cookie: YSC=abc; VISITOR_INFO1_LIVE=def\nx-goog-authuser: 0\n")
        self.assertEqual(payload["kind"], "auth")
        self.assertIn("signed in", payload["error"])

    def test_a_paste_with_no_authuser_says_so(self):
        payload, _, _ = self.run_liked(stdin=f"cookie: {SECRET_COOKIE}\n")
        self.assertIn("x-goog-authuser", payload["error"])

    def test_without_auth_stdin_nothing_is_read(self):
        payload, _, _ = self.run_liked(auth_stdin=False)
        self.assertEqual(payload["kind"], "parse")
        self.assertEqual(self.setup_calls, [])

    def test_a_failure_never_exits_with_a_traceback(self):
        StubYTMusic.error = RuntimeError("boom")
        # cmd_liked returning normally is the point: a non-zero exit would
        # make the route report "the media helper failed" instead of a reason.
        payload, _, _ = self.run_liked()
        self.assertIn("error", payload)


class LikedSecrecyTest(LikedTestCase):
    """The headers are a Google session. Nothing derived from them may leave
    the process on any path."""

    def assert_nothing_leaked(self, *streams):
        for stream in streams:
            for part in SECRET_PARTS:
                self.assertNotIn(part, stream)

    def test_the_happy_path_prints_no_part_of_them(self):
        StubYTMusic.tracks = [song("aaaaaaaaaaa", "First")]
        _, out, err = self.run_liked()
        self.assert_nothing_leaked(out, err)

    def test_an_exception_carrying_the_whole_request_leaks_nothing(self):
        # The real hazard: a library that puts the request it made, headers
        # and all, into its exception message.
        StubYTMusic.error = RuntimeError(f"POST /youtubei/v1/browse failed, headers={HEADERS}")
        _, out, err = self.run_liked()
        self.assert_nothing_leaked(out, err)
        self.assertIn(json.loads(out)["error"], player.LIKED_ERRORS.values())

    def test_a_failure_inside_the_header_parser_leaks_nothing(self):
        def exploding_setup(filepath=None, headers_raw=None):
            raise ValueError(f"Error parsing your input. Full error: {headers_raw}")

        player.ytmusicapi_setup = exploding_setup
        _, out, err = self.run_liked()
        self.assert_nothing_leaked(out, err)

    def test_the_shape_check_quotes_header_names_only(self):
        _, out, err = self.run_liked(stdin=f"cookie: {SECRET_COOKIE}\n")
        self.assert_nothing_leaked(out, err)

    def test_missing_liked_headers_answers_with_names_only(self):
        self.assertEqual(player.missing_liked_headers(HEADERS), [])
        answer = player.missing_liked_headers("accept: */*\n")
        self.assertEqual(answer, ["cookie", "x-goog-authuser"])


if __name__ == "__main__":
    unittest.main()
