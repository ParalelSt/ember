import os
import re
import sys
import json
import time
import shutil
import argparse
import contextlib
import concurrent.futures
from pathlib import Path
import requests
from ytmusicapi import YTMusic
import yt_dlp
from ffmpeg_path import ffmpeg_exe
import loudness

# ============= CONFIG =============
# MUSIC_DIR resolves relative to this script (not cwd) so the Express API can
# spawn it from any working directory. Override with the MUSIC_DIR env var.
MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", Path(__file__).parent / "my_music"))
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

yt = YTMusic()  # Works anonymously. For better results, use OAuth later.


def _cookie_opts():
    """yt-dlp cookie config to get past YouTube's intermittent "Sign in to
    confirm you're not a bot" 403s on info/stream/download. Set ONE of these
    env vars on the host (a logged-in YouTube session helps most):
      YTDLP_COOKIE_FILE=/path/to/cookies.txt        (Netscape format, LF newlines)
      YTDLP_COOKIES_FROM_BROWSER=firefox            (or chrome/chromium/brave/edge/
                                                     safari; "firefox:profile" to
                                                     pick a profile)
    Returns a dict to splat into ydl_opts; empty when neither is set, so the
    anonymous path is unchanged by default."""
    cookie_file = os.environ.get("YTDLP_COOKIE_FILE", "").strip()
    if cookie_file:
        return {"cookiefile": cookie_file}
    browser = os.environ.get("YTDLP_COOKIES_FROM_BROWSER", "").strip()
    if browser:
        name, _, profile = browser.partition(":")
        return {"cookiesfrombrowser": (name, profile or None, None, None)}
    return {}


def _ffmpeg_opts():
    """Point yt-dlp at Ember's own ffmpeg (ffmpeg_path.py: the imageio-ffmpeg
    binary, else the one on PATH), so a host needs no system install. Empty
    when there is none: yt-dlp then does what it can without it."""
    exe = ffmpeg_exe()
    return {"ffmpeg_location": exe} if exe else {}


def _js_runtime_opts():
    """yt-dlp needs a JS runtime to solve YouTube's signature/n-parameter
    challenges on some player clients; only `deno` is enabled by default,
    and most hosts don't have it installed. Without any runtime, yt-dlp
    warns and falls back to formats/clients that intermittently 403 on the
    actual media fetch (confirmed locally: same video 403'd with no runtime,
    succeeded once `node` was enabled). `node` is commonly present already
    (it runs Ember's own API server), so enable it opportunistically when
    it's on PATH. Empty when it isn't: no behavior change on a host without
    Node either, yt-dlp just keeps doing what it does today."""
    return {"js_runtimes": {"node": {}}} if shutil.which("node") else {}


def sanitize_filename(name: str) -> str:
    """Clean filename for saving."""
    return re.sub(r'[\\/*?:"<>|]', "", name)[:150]

def get_local_path(title: str, artist: str) -> Path:
    """Generate consistent filename (interactive mode)."""
    filename = f"{artist} - {title}.mp3"
    return MUSIC_DIR / sanitize_filename(filename)

CACHE_EXTS = ('m4a', 'webm', 'opus', 'mp3', 'mp4')

def find_cached(video_id: str) -> Path | None:
    """Return the cached file for this videoId regardless of container, or None."""
    for ext in CACHE_EXTS:
        p = MUSIC_DIR / f"{video_id}.{ext}"
        if p.exists():
            return p
    return None

def search_song(query: str, limit=5):
    """Interactive search: prints + returns first hit."""
    results = yt.search(query, filter="songs")
    if not results:
        print("No results found.")
        return None
    best = results[0]
    print(f"Found: {best.get('title')} by {best.get('artists')[0].get('name')}")
    return best

def parse_length(s):
    """'3:22' -> 202. '1:02:33' -> 3753. Anything else -> None."""
    if not s or not isinstance(s, str):
        return None
    try:
        nums = [int(p) for p in s.split(":")]
    except ValueError:
        return None
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    return None


def to_track_json(t):
    """Normalize a ytmusicapi result into a flat JSON record.
    Handles both the search shape (duration_seconds, thumbnails) and the
    watch_playlist / artist shape (length 'M:SS', thumbnail)."""
    artists = t.get("artists") or []
    artist = artists[0].get("name") if artists else "Unknown"
    artist_id = artists[0].get("id") if artists else None
    album_obj = t.get("album") or {}
    album = album_obj.get("name") if isinstance(album_obj, dict) else None
    album_id = album_obj.get("id") if isinstance(album_obj, dict) else None
    thumbs = t.get("thumbnails") or t.get("thumbnail") or []
    artwork = thumbs[-1].get("url") if thumbs else None
    duration = t.get("duration_seconds") or parse_length(t.get("length")) or 0
    return {
        "videoId": t.get("videoId"),
        "title": t.get("title"),
        "artist": artist,
        "artistId": artist_id,
        "album": album,
        "albumId": album_id,
        "durationSec": duration,
        "artworkUrl": artwork,
    }


def to_track_json_from_ytdlp(entry):
    """Same shape as to_track_json, but built from a yt-dlp entry returned by
    `ytsearchN:query`. Music-aware fields (artistId, album, albumId) are null
    because plain YouTube search exposes only video-level metadata. The
    `artist` falls back to the uploader / channel name."""
    thumbs = entry.get("thumbnails") or []
    artwork = thumbs[-1].get("url") if thumbs else None
    return {
        "videoId": entry.get("id"),
        "title": entry.get("title"),
        "artist": entry.get("uploader") or entry.get("channel") or "Unknown",
        "artistId": None,
        "album": None,
        "albumId": None,
        "durationSec": int(entry.get("duration") or 0),
        "artworkUrl": artwork,
    }


def _ytdlp_usable(entry):
    """yt-dlp's ytsearch results can include playlists / channels alongside
    videos. Skip anything without an id or a duration — those aren't
    playable tracks."""
    return bool(entry and entry.get("id")) and entry.get("duration") is not None


def ytdlp_search(query: str, limit: int):
    """Plain YouTube search via yt-dlp — fallback for queries that crash
    ytmusicapi. extract_flat='in_playlist' returns one batched listing
    (~1 HTTP request) instead of fetching each video page individually."""
    ydl_opts = {
        'extract_flat': 'in_playlist',
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        **_cookie_opts(),
        **_ffmpeg_opts(),
    }
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    return (info or {}).get("entries") or []


def _clean_partials(base: Path):
    """Remove leftover .part (and .ytdl) files for `base` (an output path
    without its final extension, e.g. MUSIC_DIR/<videoId> or a human-named
    file stem) so a retry starts the download fresh instead of resuming a
    truncated, possibly now-invalid partial."""
    for pattern in (f"{base.name}*.part", f"{base.name}*.ytdl"):
        for p in base.parent.glob(pattern):
            try:
                p.unlink()
            except OSError:
                pass


def _is_403(exc) -> bool:
    return "403" in str(exc)


def _download_with_403_retry(run, cleanup):
    """Run `run()` (a zero-arg callable performing the yt-dlp download).
    YouTube's signed media URLs intermittently 403 on the very first fetch
    (observed locally: no JS runtime available made this reliably
    reproducible, but the URLs are also short-lived and can expire between
    extraction and fetch even with one). A fresh `extract_info`/`download`
    call gets newly-signed URLs, so one retry after cleaning up any partial
    file usually succeeds. Only a DownloadError whose message shows a 403 is
    retried, and only once: any other error, or a second 403, propagates."""
    try:
        return run()
    except yt_dlp.utils.DownloadError as e:
        if not _is_403(e):
            raise
        print("[download] HTTP 403, cleaning partials and retrying once", file=sys.stderr)
        cleanup()
        return run()


def download_if_needed(video_id: str, title: str, artist: str) -> Path:
    """Interactive: human-named file, verbose output."""
    file_path = get_local_path(title, artist)
    if file_path.exists():
        print(f"Already downloaded: {file_path.name}")
        return file_path
    print(f"Downloading: {title}...")
    base = file_path.with_suffix('')
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': str(base),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'embedthumbnail': True,
        'addmetadata': True,
        'quiet': False,
        **_cookie_opts(),
        **_ffmpeg_opts(),
        **_js_runtime_opts(),
    }
    url = f"https://www.youtube.com/watch?v={video_id}"

    def _attempt():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return file_path

    return _download_with_403_retry(_attempt, lambda: _clean_partials(base))

def download_by_id(video_id: str) -> Path:
    """API mode: download YouTube's native audio (no transcode) so the first
    frames aren't clipped by mp3 encoder priming. Files are saved as
    <videoId>.<m4a|webm|opus> depending on what YT serves."""
    cached = find_cached(video_id)
    if cached:
        return cached

    base = MUSIC_DIR / video_id
    outtmpl = str(MUSIC_DIR / f"{video_id}.%(ext)s")
    ydl_opts = {
        # Prefer m4a (AAC) since browsers decode it cleanly without WebM/Opus quirks.
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
        'outtmpl': outtmpl,
        'quiet': True,
        'no_warnings': True,
        **_cookie_opts(),
        **_ffmpeg_opts(),
        **_js_runtime_opts(),
    }
    url = f"https://www.youtube.com/watch?v={video_id}"

    # Belt-and-suspenders: redirect any stray prints from yt-dlp/postprocessors
    # to stderr so stdout stays pure JSON for the Node parent to read.
    def _attempt():
        with contextlib.redirect_stdout(sys.stderr):
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url)
                return Path(ydl.prepare_filename(info))

    return _download_with_403_retry(_attempt, lambda: _clean_partials(base))

def play_song(file_path: Path):
    """Play the MP3 (interactive mode only)."""
    from playsound3 import playsound  # lazy: API mode never needs audio output
    print(f"Playing: {file_path.name}")
    try:
        playsound(str(file_path), block=True)
    except Exception as e:
        print("Playback error:", e)

# ============= CLI HANDLERS =============
# What a ytmusicapi parser crash raises (its nav() on a response shape it
# doesn't know). Deterministic: asking again gives the same crash.
PARSER_ERRORS = (KeyError, IndexError, TypeError, AttributeError)


def _search_songs(query, limit):
    return yt.search(query, filter="songs", limit=limit)


def _search_videos(query, limit):
    return yt.search(query, filter="videos", limit=limit)


def cmd_search(args):
    # Run songs + videos in parallel. Songs come first in the merged list
    # (music-aware metadata). Videos backfill rare tracks that aren't in
    # YouTube Music's songs catalog (niche / doujin / fan-uploaded).
    # See docs/superpowers/specs/2026-06-09-search-songs-videos-merge-design.md.
    songs, videos = [], []
    # A backend that could not be asked (network, busy) as opposed to one
    # that crashed parsing this query. If nothing is found and any backend
    # could not be asked, the search fails: "no results" would be cached.
    unreachable = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        songs_future = ex.submit(_search_songs, args.query, args.limit)
        videos_future = ex.submit(_search_videos, args.query, args.limit)
        try:
            songs = songs_future.result() or []
        except Exception as e:
            unreachable = unreachable or not isinstance(e, PARSER_ERRORS)
            print(
                f"[search] ytmusicapi songs failed for query={args.query!r}: {type(e).__name__}: {e}",
                file=sys.stderr,
            )
        try:
            videos = videos_future.result() or []
        except Exception as e:
            unreachable = unreachable or not isinstance(e, PARSER_ERRORS)
            print(
                f"[search] ytmusicapi videos failed for query={args.query!r}: {type(e).__name__}: {e}",
                file=sys.stderr,
            )

    # Reserve slots for videos so a niche track (e.g., DJ Sharpnel's
    # "Back to the Gate" which isn't in YT Music's songs catalog but is
    # the top video hit) still surfaces even when songs returns a full
    # page of unrelated results. Songs get ~2/3 of slots, videos ~1/3.
    # Either tier backfills the other if it returns fewer items.
    video_floor = max(5, args.limit // 3)
    song_cap = max(1, args.limit - video_floor)

    seen = set()
    merged = []

    def _add(items, cap):
        for t in items:
            if len(merged) >= cap:
                return
            vid = t.get("videoId")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            merged.append(to_track_json(t))

    _add(songs, song_cap)
    _add(videos, args.limit)
    # Backfill leftover slots with any remaining songs/videos we skipped.
    _add(songs, args.limit)
    _add(videos, args.limit)

    if merged:
        json.dump(merged, sys.stdout)
        return

    # Neither backend produced anything — fall back to yt-dlp.
    print(f"[search] falling back to yt-dlp for query={args.query!r}", file=sys.stderr)
    entries = []
    try:
        entries = ytdlp_search(args.query, args.limit)
    except Exception as e:
        unreachable = True
        print(
            f"[search] yt-dlp fallback failed for query={args.query!r}: {type(e).__name__}: {e}",
            file=sys.stderr,
        )

    tracks = [to_track_json_from_ytdlp(e) for e in entries if _ytdlp_usable(e)]
    print(
        f"[search] yt-dlp fallback returned {len(tracks)} entries for query={args.query!r}",
        file=sys.stderr,
    )
    if not tracks and unreachable:
        print("ERROR: search is unavailable right now, try again shortly", file=sys.stderr)
        sys.exit(1)
    json.dump(tracks, sys.stdout)

def cmd_download(args):
    if not args.video_id:
        print("[download] called without a video_id", file=sys.stderr)
        json.dump({"error": "video_id required"}, sys.stdout)
        return
    file_path = download_by_id(args.video_id)
    json.dump({"filePath": str(file_path.resolve())}, sys.stdout)

def cmd_info(args):
    """Resolve a videoId to a direct streamable URL (no download).
    Used by the API's stream-proxy mode so songs aren't saved to disk."""
    if not args.video_id:
        print("[info] called without a video_id", file=sys.stderr)
        json.dump({"error": "video_id required"}, sys.stdout)
        return
    url = f"https://www.youtube.com/watch?v={args.video_id}"
    ydl_opts = {
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        **_cookie_opts(),
        **_ffmpeg_opts(),
        **_js_runtime_opts(),
    }
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    json.dump({
        "url": info.get("url"),
        "ext": info.get("ext"),
        "filesize": info.get("filesize") or info.get("filesize_approx"),
        "durationSec": info.get("duration"),
        "title": info.get("title"),
        # The headers yt-dlp used to fetch this format (notably User-Agent).
        # googlevideo URLs are signed for the client that resolved them, so the
        # proxy MUST replay these when fetching — a mismatched UA gets a 403.
        "httpHeaders": info.get("http_headers") or {},
    }, sys.stdout)

def cmd_track(args):
    """Resolve a single videoId to track metadata via ytmusicapi get_song.
    Works for any public YouTube video, not just YT Music-classified songs.
    Used by the shareable /track/<videoId> page for ids nobody has played
    yet (PB rows take priority on the Node side). Note: author/channelId
    are video-level (the uploader), same compromise as the videos search
    tier — PB-cached tracks keep their proper music metadata."""
    try:
        song = yt.get_song(args.video_id)
    except (KeyError, TypeError, AttributeError) as e:
        print(f"[track] get_song failed for {args.video_id!r}: {type(e).__name__}: {e}", file=sys.stderr)
        json.dump({"error": "not found"}, sys.stdout)
        return
    details = (song or {}).get("videoDetails") or {}
    if not details.get("videoId"):
        json.dump({"error": "not found"}, sys.stdout)
        return
    thumbs = ((details.get("thumbnail") or {}).get("thumbnails")) or []
    artwork = thumbs[-1].get("url") if thumbs else None
    json.dump({
        "videoId": details.get("videoId"),
        "title": details.get("title"),
        "artist": details.get("author"),
        "artistId": details.get("channelId"),
        "album": None,
        "albumId": None,
        "durationSec": int(details.get("lengthSeconds") or 0),
        "artworkUrl": artwork,
    }, sys.stdout)

def cmd_recommended(args):
    """Songs related to a seed videoId — uses YT Music's 'watch playlist'
    (the up-next radio for that song). Falls back to the daily chart when the
    seed is missing or the lookup fails."""
    items = []
    if args.seed:
        try:
            wp = yt.get_watch_playlist(videoId=args.seed, limit=args.limit)
            items = (wp or {}).get('tracks', []) or []
            # First item is often the seed track itself; drop it so the user
            # sees actual recommendations, not a self-reference.
            items = [t for t in items if t.get('videoId') != args.seed]
        except Exception as e:
            print(f"recommended: watch_playlist failed ({e})", file=sys.stderr)

    if not items:
        try:
            json.dump(chart_tracks(args.country)["tracks"][:args.limit], sys.stdout)
        except Exception as e:
            print(f"recommended: chart fallback failed ({e})", file=sys.stderr)
            json.dump([], sys.stdout)
        return

    tracks = [to_track_json(t) for t in items if t.get('videoId')]
    json.dump(tracks, sys.stdout)

# What YouTube Music answers for an album or artist id that doesn't exist: a
# response with no page at all, so ytmusicapi fails on the very first key.
# A layout change fails deeper in the path and stays a plain failure.
BROWSE_MISSING_RE = re.compile(r"Unable to find 'contents' using path \['contents',|HTTP 404")


def _browse_error(kind, e):
    """A short {error, reason} for an album/artist lookup that raised. The
    exception itself (ytmusicapi dumps the whole response into it) only goes
    to stderr, never to the browser."""
    if BROWSE_MISSING_RE.search(str(e)):
        return {"error": f"{kind.capitalize()} not found", "reason": "not-found"}
    return {"error": f"Couldn't load this {kind} from YouTube Music right now", "reason": "failed"}


def cmd_artist(args):
    """Resolve a YT Music artist channelId to the artist profile + their
    top songs. The user clicks an artist name in a track row, which routes
    to /artist/<channelId>; this fills that page."""
    try:
        info = yt.get_artist(channelId=args.channel_id)
    except Exception as e:
        print(f"artist failed: {type(e).__name__}: {e}", file=sys.stderr)
        json.dump(_browse_error("artist", e), sys.stdout)
        return

    # Pull top tracks from search rather than yt.get_artist()['songs']: the
    # latter returns no duration_seconds OR length, while search returns
    # both. Search ranking ≈ artist top songs for the same artist anyway.
    songs = []
    artist_name = (info.get("name") or "").strip()
    if artist_name:
        try:
            results = yt.search(artist_name, filter="songs", limit=30)
            for e in results or []:
                if not e.get("videoId"):
                    continue
                # Only include results attributed to THIS artist's channelId.
                # Matching by name mixed up same-named artists (two "Noah"s
                # shared one page); search entries carry the artist id, so
                # match on that. Entries without ids are dropped — the
                # get_artist() fallback below covers an over-strict filter.
                if not any(a.get("id") == args.channel_id
                           for a in (e.get("artists") or [])):
                    continue
                songs.append(e)
        except Exception as e:
            print(f"artist: search failed: {e}", file=sys.stderr)

    # Fallback: if the search returned nothing (rare — search down, or the
    # artist name is too generic to match cleanly), surface whatever
    # get_artist() gave us so the page isn't blank. Those rows won't have
    # durations, but the page works.
    if not songs:
        songs = (info.get("songs") or {}).get("results") or []

    albums = (info.get("albums") or {}).get("results") or []
    # Standalone singles/EPs are a separate get_artist() category from albums;
    # without this they never reach the artist page (e.g. "Shadow of Intent -
    # The Migrant"). Same shape as albums — each is an album-type browseId.
    singles = (info.get("singles") or {}).get("results") or []

    def album_json(a):
        return {
            "browseId": a.get("browseId"),
            "title": a.get("title"),
            "year": a.get("year"),
            "thumbnails": a.get("thumbnails"),
        }

    out = {
        "name": info.get("name"),
        "description": info.get("description"),
        "thumbnails": info.get("thumbnails") or [],
        "tracks": [to_track_json(t) for t in songs if t.get("videoId")],
        "albums": [album_json(a) for a in albums if a.get("browseId")],
        "singles": [album_json(a) for a in singles if a.get("browseId")],
    }
    json.dump(out, sys.stdout)

def cmd_album(args):
    """Resolve an album browseId to title/artist/year/cover + tracks.
    Used by the album page to render a Spotify-style album view."""
    try:
        info = yt.get_album(browseId=args.browse_id)
    except Exception as e:
        print(f"album failed: {type(e).__name__}: {e}", file=sys.stderr)
        json.dump(_browse_error("album", e), sys.stdout)
        return

    artists = info.get("artists") or []
    primary = artists[0] if artists else {}
    tracks_raw = info.get("tracks") or []
    tracks = [to_track_json(t) for t in tracks_raw if t.get("videoId")]

    out = {
        "title": info.get("title"),
        "artist": primary.get("name"),
        "artistId": primary.get("id"),
        "year": int(info.get("year")) if str(info.get("year") or "").isdigit() else None,
        "thumbnails": info.get("thumbnails") or [],
        "trackCount": info.get("trackCount") or len(tracks),
        "totalDurationSec": info.get("duration_seconds") or sum((t.get("durationSec") or 0) for t in tracks),
        "tracks": tracks,
    }
    json.dump(out, sys.stdout)

def cmd_lyrics(args):
    """Fetch lyrics from Genius by direct search + page scrape — no API
    token required. Hits Genius's public /api/search/multi endpoint
    (the same one their own frontend uses), picks the best song hit,
    then parses the song page's data-lyrics-container divs.

    Returns {"lyrics", "source": "genius", "url"} on hit,
    {"lyrics": null, "source": "none"} on no match, {"error"} on
    failure."""
    from urllib.request import Request, urlopen
    from urllib.parse import quote
    from html.parser import HTMLParser
    import json as _json

    UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

    def _fetch(url, accept="text/html,application/json"):
        req = Request(url, headers={"User-Agent": UA, "Accept": accept})
        with urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8", errors="replace")

    def _search(title, artist):
        q = quote(f"{title} {artist}".strip())
        url = f"https://genius.com/api/search/multi?per_page=5&q={q}"
        data = _json.loads(_fetch(url, accept="application/json"))
        sections = (data.get("response") or {}).get("sections") or []
        # Prefer the song-typed section, fall back to whatever has a URL.
        for s in sections:
            if s.get("type") == "song":
                for h in (s.get("hits") or []):
                    r = h.get("result") or {}
                    if r.get("url"):
                        return r
        for s in sections:
            for h in (s.get("hits") or []):
                r = h.get("result") or {}
                if r.get("url"):
                    return r
        return None

    class _LyricsParser(HTMLParser):
        """Pulls out every data-lyrics-container div from the page,
        tracking nested div depth so we get the WHOLE container (Genius
        wraps verses in inner divs, which a non-greedy regex would
        truncate). Inserts \\n on <br> and \\n\\n between containers."""

        def __init__(self):
            super().__init__()
            self.parts = []
            self._in = False
            self._depth = 0
            self._buf = []

        def handle_starttag(self, tag, attrs):
            attrs_d = dict(attrs)
            if tag == 'div' and attrs_d.get('data-lyrics-container') == 'true':
                self._in = True
                self._depth = 1
                self._buf = []
                return
            if not self._in:
                return
            if tag == 'div':
                self._depth += 1
            elif tag == 'br':
                self._buf.append('\n')

        def handle_endtag(self, tag):
            if not self._in or tag != 'div':
                return
            self._depth -= 1
            if self._depth == 0:
                chunk = ''.join(self._buf).strip()
                if chunk:
                    self.parts.append(chunk)
                self._in = False
                self._buf = []

        def handle_data(self, data):
            if self._in:
                self._buf.append(data)

        def handle_entityref(self, name):
            # html.parser doesn't auto-decode entities into handle_data
            # in convert_charrefs=False mode; default is True so this is
            # a no-op on modern Python but kept for older 3.x.
            pass

    def _extract(html_text):
        p = _LyricsParser()
        p.feed(html_text)
        if not p.parts:
            return None
        out = '\n\n'.join(p.parts).strip()
        out = re.sub(r'\n{3,}', '\n\n', out)
        # Strip the "<N> Contributors / Translations…" preamble Genius
        # injects above the lyrics. Use the first canonical section
        # header to anchor the start of the real content.
        m = re.search(
            r'\[(Verse|Chorus|Pre-?Chorus|Post-?Chorus|Bridge|Hook|Intro|Outro|Refrain|Interlude|Drop|Break)',
            out,
        )
        if m:
            out = out[m.start():].strip()
        # Strip the "<N>Embed" footer Genius appends.
        out = re.sub(r'\d*Embed\s*$', '', out).strip()
        return out or None

    try:
        song = _search(args.title, args.artist)
        if not song or not song.get("url"):
            json.dump({"lyrics": None, "source": "none"}, sys.stdout)
            return
        page = _fetch(song["url"])
        lyrics = _extract(page)
        if not lyrics:
            json.dump({"lyrics": None, "source": "none"}, sys.stdout)
            return
        json.dump({"lyrics": lyrics, "source": "genius", "url": song["url"]}, sys.stdout)
    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)

# Chart playlists as ytmusicapi's get_charts lists them under "videos", in
# order of preference. Titles carry the country ("... - Global", "... Germany").
CHART_TITLE_PREFERENCE = ("Daily Top Music Videos", "Trending 20", "Top 100")
# "Daily Top Music Videos - Global": used when get_charts itself fails.
GLOBAL_DAILY_CHART_ID = "PL4fGSI1pDJn6t3TXLGiiJdD-sZbrG3tG0"


def pick_chart_playlist(charts):
    """Pick the chart playlist from a get_charts() result, or None.

    ytmusicapi 1.12 returns `videos` as a plain list of chart playlists
    ({title, playlistId, thumbnails}). Older versions wrapped lists in
    {"items": [...]}; both are accepted so a shape change fails loudly in the
    unit test rather than silently returning nothing."""
    if not isinstance(charts, dict):
        return None
    lists = charts.get("videos")
    if isinstance(lists, dict):
        lists = lists.get("items")
    lists = [p for p in (lists or []) if isinstance(p, dict) and p.get("playlistId")]
    for prefix in CHART_TITLE_PREFERENCE:
        for p in lists:
            if (p.get("title") or "").startswith(prefix):
                return p
    return lists[0] if lists else None


def chart_playlist_tracks(playlist):
    """Map a get_playlist() result to track JSON, keeping chart order and
    dropping entries with no videoId or marked unavailable."""
    raw = (playlist or {}).get("tracks") or []
    return [
        to_track_json(t)
        for t in raw
        if t.get("videoId") and t.get("isAvailable") is not False
    ]


def ytdlp_playlist(playlist_id):
    """Flat listing of a YouTube playlist via yt-dlp: the fallback parser for
    the same chart when ytmusicapi's get_playlist fails."""
    ydl_opts = {
        'extract_flat': 'in_playlist',
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        **_cookie_opts(),
        **_ffmpeg_opts(),
    }
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    entries = (info or {}).get("entries") or []
    return [to_track_json_from_ytdlp(e) for e in entries if e and e.get("id")]


def chart_tracks(country, allow_global_fallback=True):
    """The daily chart for a country (ZZ = global), in rank order.

    get_charts -> pick the chart playlist by title -> get_playlist, then
    yt-dlp on the same playlist id. Raises when every source fails, so the
    server keeps serving its last good list instead of something that only
    looks like a chart.

    When `allow_global_fallback` is False, a country whose own chart can't
    be found raises instead of silently substituting the global chart: a
    blend of several countries must not count the same global chart twice
    under two different countries' names."""
    picked = None
    try:
        picked = pick_chart_playlist(yt.get_charts(country=country))
    except Exception as e:
        print(f"trending: get_charts failed ({e})", file=sys.stderr)
    if not picked:
        if not allow_global_fallback:
            raise RuntimeError(f"trending: no chart playlist found for {country}")
        print("trending: no chart playlist found, using the global daily chart", file=sys.stderr)
        picked = {"playlistId": GLOBAL_DAILY_CHART_ID, "title": "Daily Top Music Videos - Global"}
    playlist_id = picked["playlistId"]
    title = picked.get("title")

    try:
        tracks = chart_playlist_tracks(yt.get_playlist(playlist_id, limit=None))
        if tracks:
            return {"title": title, "playlistId": playlist_id, "source": "ytmusicapi", "tracks": tracks}
        print("trending: get_playlist returned no tracks", file=sys.stderr)
    except Exception as e:
        print(f"trending: get_playlist failed ({e})", file=sys.stderr)

    tracks = ytdlp_playlist(playlist_id)
    if not tracks:
        raise RuntimeError("trending: no chart source returned tracks")
    return {"title": title, "playlistId": playlist_id, "source": "yt-dlp", "tracks": tracks}


# Pause between two live get_charts/get_playlist calls for different
# countries: a rapid second call has answered HTTP 503 (see docs/trending.md).
CHART_FETCH_PACING_SEC = 3


def normalize_song_key(title, artist):
    """A loose identity for cross-country dedupe: same song, different
    videoId per country. Strips everything but letters and digits so casing,
    punctuation and spacing differences do not create duplicate entries."""
    def clean(s):
        return re.sub(r'[^a-z0-9]+', '', (s or '').lower())
    return f"{clean(title)}|{clean(artist)}"


def fetch_country_charts(countries, allow_global_fallback=True):
    """Each country's daily chart, sequentially with pacing between live
    calls. Returns (successes, failures): successes is [(country, tracks)],
    failures is the list of countries whose chart could not be fetched.

    `allow_global_fallback` should be False whenever more than one country
    is being blended: otherwise a country with no chart of its own silently
    gets the global chart under its name, and the blend double-counts the
    global chart as if it were two countries agreeing."""
    successes, failures = [], []
    for i, country in enumerate(countries):
        if i > 0:
            time.sleep(CHART_FETCH_PACING_SEC)
        try:
            tracks = chart_tracks(country, allow_global_fallback=allow_global_fallback)["tracks"]
            successes.append((country, tracks))
        except Exception as e:
            print(f"trending: {country} chart failed ({e})", file=sys.stderr)
            failures.append(country)
    return successes, failures


def blend_charts(country_tracks, cap=100):
    """Merge several countries' daily charts into one ranked list.

    Borda-style score: a song's points are the sum, over every country chart
    it appears in, of (N - rank + 1) where N is that chart's length. Ties
    break on the best (lowest) single rank. Songs are grouped by videoId AND
    by normalized title+artist, since the same song often has a different
    videoId per country. Returns tracks in blended rank order, capped."""
    groups = {}
    videoid_to_group = {}
    key_to_group = {}
    next_id = 0
    for _country, tracks in country_tracks:
        n = len(tracks)
        for idx, t in enumerate(tracks):
            rank = idx + 1
            points = n - rank + 1
            vid = t.get("videoId")
            key = normalize_song_key(t.get("title"), t.get("artist"))
            gid = videoid_to_group.get(vid) if vid else None
            if gid is None:
                gid = key_to_group.get(key)
            if gid is None:
                gid = next_id
                next_id += 1
                groups[gid] = {"score": 0, "best_rank": rank, "track": t}
            g = groups[gid]
            g["score"] += points
            if rank < g["best_rank"]:
                g["best_rank"] = rank
                g["track"] = t
            if vid:
                videoid_to_group[vid] = gid
            key_to_group[key] = gid
    ordered = sorted(groups.values(), key=lambda g: (-g["score"], g["best_rank"]))
    return [g["track"] for g in ordered[:cap]]


def cmd_trending(args):
    """Today's chart, blended across one or more countries, as
    {title, countries, tracks}. `countries` lists the codes that actually
    made it into the blend (a country whose chart failed is skipped, not
    fatal). Exits non-zero only when every country failed; the server then
    serves its cached list."""
    countries = [c.strip().upper() for c in (args.countries or "").split(",") if c.strip()] or [args.country]
    successes, failures = fetch_country_charts(countries, allow_global_fallback=len(countries) == 1)
    if not successes:
        print("ERROR: trending: every country's chart failed", file=sys.stderr)
        sys.exit(1)
    if failures:
        print(f"trending: blended without {', '.join(failures)}", file=sys.stderr)
    used = [c for c, _ in successes]
    tracks = blend_charts(successes, cap=100)
    title = "Trending blend" if len(used) > 1 else None
    json.dump({"title": title, "countries": used, "tracks": tracks}, sys.stdout)

def _ytdlp_playlist(playlist_id):
    """Fallback reader for a public playlist when ytmusicapi fails: the same
    listing `yt-dlp --flat-playlist -J` prints. Also reads plain YouTube
    playlists. Entries carry video-level metadata only, so `artist` is the
    channel name (without YouTube's " - Topic" suffix)."""
    ydl_opts = {
        'extract_flat': 'in_playlist',
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        **_cookie_opts(),
        **_ffmpeg_opts(),
    }
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/playlist?list={playlist_id}", download=False)
    tracks = []
    for e in (info or {}).get("entries") or []:
        if not e or not e.get("id") or e.get("duration") is None:
            continue
        t = to_track_json_from_ytdlp(e)
        t["artist"] = re.sub(r"\s*-\s*Topic$", "", t["artist"] or "") or "Unknown"
        tracks.append(t)
    return {"title": (info or {}).get("title") or "Imported playlist", "tracks": tracks}


def _playlist_error_reason(message):
    """Sort a playlist read failure into what the user can do about it."""
    m = (message or "").lower()
    if "private" in m or "sign in" in m or "members" in m:
        return "private"
    if "does not exist" in m or "not found" in m or "404" in m or "400" in m or "unavailable" in m:
        return "not-found"
    return "failed"


def cmd_ytplaylist(args):
    """Fetch a public YouTube Music playlist (no auth) -> {title, tracks}.
    Used by the playlist-import feature. ytmusicapi first; when it errors,
    yt-dlp's flat playlist listing. A failure of both prints a clean JSON
    error with a `reason` (private, not-found, failed) the API maps to a
    friendly message."""
    try:
        pl = yt.get_playlist(args.playlist_id, limit=None)
        raw = pl.get("tracks") or []
        out = {
            "title": pl.get("title") or "Imported playlist",
            "tracks": [to_track_json(t) for t in raw if t.get("videoId")],
        }
        json.dump(out, sys.stdout)
        return
    except Exception as e:
        print(f"ytplaylist: ytmusicapi failed ({e}); trying yt-dlp", file=sys.stderr)
    try:
        json.dump(_ytdlp_playlist(args.playlist_id), sys.stdout)
    except Exception as e:
        print(f"ytplaylist: yt-dlp failed: {e}", file=sys.stderr)
        json.dump({"error": str(e), "reason": _playlist_error_reason(str(e))}, sys.stdout)


MATCH_CANDIDATES = 5


def to_candidate_json(h):
    """A search hit as a match candidate: the track fields plus what the
    scorer (apps/web/lib/import/score.ts) needs. No scoring happens here."""
    out = to_track_json(h)
    out["artists"] = [a.get("name") for a in (h.get("artists") or []) if a.get("name")]
    vt = h.get("videoType") or ""
    out["videoType"] = vt.replace("MUSIC_VIDEO_TYPE_", "") or None
    explicit = h.get("isExplicit")
    out["isExplicit"] = explicit if isinstance(explicit, bool) else None
    return out


def cmd_match(args):
    """Search candidates for source playlist tracks. Each query arg is
    "title<TAB>artist"; prints {results: [[candidate, ...], ...]} in input
    order, up to 5 raw candidates each (search order, unscored: the web app
    scores them). With --title-only the search is the title alone with
    ignore_spelling, the second try for a track the first search missed.
    One YTMusic init serves the whole batch (callers keep batches at about 8)."""
    results = []
    # Indexes whose search raised (503s, timeouts): an empty list there means
    # "could not ask", not "nothing found", and the caller retries the batch.
    failed = []
    for q in args.queries:
        title, _, artist = q.partition("\t")
        title = title.strip()
        artist = artist.strip()
        if not title:
            results.append([])
            continue
        try:
            if args.title_only:
                hits = yt.search(title, filter="songs", limit=MATCH_CANDIDATES, ignore_spelling=True) or []
            else:
                hits = yt.search(f"{title} {artist}".strip(), filter="songs", limit=MATCH_CANDIDATES) or []
            hits = [h for h in hits if h.get("videoId")][:MATCH_CANDIDATES]
            cands = [to_candidate_json(h) for h in hits]
        except Exception as e:
            print(f"match: search failed for {title!r}: {type(e).__name__}: {e}", file=sys.stderr)
            # Only a failure worth retrying is "failed": a parser crash on a
            # result shape ytmusicapi doesn't know repeats on every retry and
            # would stall the import, so it counts as nothing found.
            if _search_retryable(e):
                failed.append(len(results))
            results.append([])
            continue
        results.append(cands)
    json.dump({"results": results, "failed": failed}, sys.stdout)


def _search_retryable(e):
    """YouTube Music busy or the network failing, as opposed to a bug.
    Parser crashes are ruled out first: ytmusicapi's message dumps the whole
    response, where a "503" or "544" is just a number."""
    if isinstance(e, PARSER_ERRORS):
        return False
    if isinstance(e, (requests.exceptions.RequestException, json.JSONDecodeError)):
        return True
    return bool(BUSY_RE.search(str(e)) or re.search(r"HTTP 5\d\d|timed out|connection", str(e), re.I))

# YouTube Music's own word on what a video is. Anything else (no type, an
# unplayable video, a podcast episode) is not a song Ember brings over.
MUSIC_VIDEO_TYPES = {
    "MUSIC_VIDEO_TYPE_ATV": "ATV",  # official audio, from a "Topic" channel
    "MUSIC_VIDEO_TYPE_OMV": "OMV",  # official music video
    "MUSIC_VIDEO_TYPE_UGC": "UGC",  # someone's upload: may or may not be a song
}
CLASSIFY_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
# YouTube Music telling Ember to slow down, as opposed to one video failing.
BUSY_RE = re.compile(r"\b(429|503)\b|too many requests|service unavailable|rate.?limit", re.I)


def cmd_classify(args):
    """What YouTube Music calls each liked video, for the Google likes
    transfer: prints {results: {videoId: "ATV"|"OMV"|"UGC"|null}, failed:
    [videoId, ...], busy: bool}. One anonymous get_song per id (callers keep
    batches at about 8). A video whose lookup raised is null and listed in
    `failed`; a lookup refused for going too fast, or a network/5xx error
    that says nothing about the video itself, sets `busy` and stops the
    batch there, so the caller backs off and repeats it instead of the like
    being counted as not music."""
    results = {}
    failed = []
    busy = False
    for vid in args.video_ids:
        if not CLASSIFY_ID_RE.match(vid):
            results[vid] = None
            failed.append(vid)
            continue
        try:
            song = yt.get_song(vid) or {}
        except Exception as e:
            print(f"classify: get_song failed for {vid!r}: {type(e).__name__}: {e}", file=sys.stderr)
            if _search_retryable(e):
                busy = True
                break
            results[vid] = None
            failed.append(vid)
            continue
        details = song.get("videoDetails") or {}
        results[vid] = MUSIC_VIDEO_TYPES.get(details.get("musicVideoType") or "")
    json.dump({"results": results, "failed": failed, "busy": busy}, sys.stdout)


def cmd_interactive():
    """Original behavior: prompt → search → download → play."""
    query = input("Search for a song: ")
    song = search_song(query)
    if song:
        video_id = song['videoId']
        title = song['title']
        artist = song.get('artists', [{}])[0].get('name', 'Unknown')
        mp3_file = download_if_needed(video_id, title, artist)
        play_song(mp3_file)

def main():
    parser = argparse.ArgumentParser(description="Ember music player / YouTube Music helper.")
    sub = parser.add_subparsers(dest="cmd")

    p_search = sub.add_parser("search", help="Search YT Music. Prints JSON to stdout.")
    p_search.add_argument("query")
    p_search.add_argument("--limit", type=int, default=30)

    p_download = sub.add_parser("download", help="Download by videoId. Prints {filePath} JSON.")
    # nargs='?' so a missing id degrades to a clean JSON error in the handler
    # instead of an argparse hard-crash (exit 2 + stderr) that surfaces as an
    # ugly 502 in the API logs.
    p_download.add_argument("video_id", nargs="?")

    p_trending = sub.add_parser("trending", help="Daily chart playlist, blended across countries, in rank order. Prints JSON.")
    p_trending.add_argument("--country", default="ZZ", help="2-letter country code, ZZ=global (ignored if --countries is given)")
    p_trending.add_argument("--countries", help="Comma list of 2-letter country codes to blend, e.g. US,GB,DE,RS")

    p_info = sub.add_parser("info", help="Resolve a videoId to a direct stream URL. Prints JSON.")
    p_info.add_argument("video_id", nargs="?")

    p_rec = sub.add_parser("recommended", help="Up-next radio for a seed videoId. Prints JSON.")
    p_rec.add_argument("--seed", help="Seed videoId; missing falls back to the daily chart")
    p_rec.add_argument("--limit", type=int, default=30)
    p_rec.add_argument("--country", default="ZZ")

    p_artist = sub.add_parser("artist", help="Artist profile + top songs by channelId. Prints JSON.")
    p_artist.add_argument("channel_id")

    p_album = sub.add_parser("album", help="Album detail by browseId. Prints JSON.")
    p_album.add_argument("browse_id")

    p_lyrics = sub.add_parser("lyrics", help="Genius lyrics for title + artist. Prints JSON.")
    p_lyrics.add_argument("title")
    p_lyrics.add_argument("artist")

    p_track = sub.add_parser("track", help="Resolve one videoId to track metadata. Prints JSON.")
    p_track.add_argument("video_id")

    p_ytpl = sub.add_parser("ytplaylist", help="Public YT Music playlist → {title, tracks}. Prints JSON.")
    p_ytpl.add_argument("playlist_id")

    p_match = sub.add_parser("match", help='Top 5 YT Music candidates per "title<TAB>artist" query. Prints JSON.')
    p_match.add_argument("--title-only", action="store_true", help="Search the title alone, ignore_spelling on")
    p_match.add_argument("queries", nargs="+")

    p_loud = sub.add_parser("loudness", help="Measure a downloaded song's loudness, write its gain sidecar. Prints JSON.")
    p_loud.add_argument("video_id", nargs="?")

    p_classify = sub.add_parser("classify", help="YouTube Music's type (ATV, OMV, UGC or null) per videoId. Prints JSON.")
    p_classify.add_argument("video_ids", nargs="+")

    args = parser.parse_args()

    if args.cmd == "search":
        cmd_search(args)
    elif args.cmd == "download":
        cmd_download(args)
    elif args.cmd == "trending":
        cmd_trending(args)
    elif args.cmd == "info":
        cmd_info(args)
    elif args.cmd == "recommended":
        cmd_recommended(args)
    elif args.cmd == "artist":
        cmd_artist(args)
    elif args.cmd == "album":
        cmd_album(args)
    elif args.cmd == "lyrics":
        cmd_lyrics(args)
    elif args.cmd == "track":
        cmd_track(args)
    elif args.cmd == "ytplaylist":
        cmd_ytplaylist(args)
    elif args.cmd == "match":
        cmd_match(args)
    elif args.cmd == "classify":
        cmd_classify(args)
    elif args.cmd == "loudness":
        sys.exit(loudness.main([args.video_id] if args.video_id else []))
    else:
        cmd_interactive()

if __name__ == "__main__":
    main()
