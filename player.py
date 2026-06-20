import os
import re
import sys
import json
import argparse
import contextlib
import concurrent.futures
from pathlib import Path
from ytmusicapi import YTMusic
import yt_dlp

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
    }
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    return (info or {}).get("entries") or []


def download_if_needed(video_id: str, title: str, artist: str) -> Path:
    """Interactive: human-named file, verbose output."""
    file_path = get_local_path(title, artist)
    if file_path.exists():
        print(f"Already downloaded: {file_path.name}")
        return file_path
    print(f"Downloading: {title}...")
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': str(file_path.with_suffix('')),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'embedthumbnail': True,
        'addmetadata': True,
        'quiet': False,
        **_cookie_opts(),
    }
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    return file_path

def download_by_id(video_id: str) -> Path:
    """API mode: download YouTube's native audio (no transcode) so the first
    frames aren't clipped by mp3 encoder priming. Files are saved as
    <videoId>.<m4a|webm|opus> depending on what YT serves."""
    cached = find_cached(video_id)
    if cached:
        return cached

    outtmpl = str(MUSIC_DIR / f"{video_id}.%(ext)s")
    ydl_opts = {
        # Prefer m4a (AAC) since browsers decode it cleanly without WebM/Opus quirks.
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
        'outtmpl': outtmpl,
        'quiet': True,
        'no_warnings': True,
        **_cookie_opts(),
    }
    url = f"https://www.youtube.com/watch?v={video_id}"
    # Belt-and-suspenders: redirect any stray prints from yt-dlp/postprocessors
    # to stderr so stdout stays pure JSON for the Node parent to read.
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url)
            file_path = Path(ydl.prepare_filename(info))
    return file_path

def play_song(file_path: Path):
    """Play the MP3 (interactive mode only)."""
    from playsound3 import playsound  # lazy: API mode never needs audio output
    print(f"Playing: {file_path.name}")
    try:
        playsound(str(file_path), block=True)
    except Exception as e:
        print("Playback error:", e)

# ============= CLI HANDLERS =============
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
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            songs_future = ex.submit(_search_songs, args.query, args.limit)
            videos_future = ex.submit(_search_videos, args.query, args.limit)
            try:
                songs = songs_future.result() or []
            except (KeyError, TypeError, AttributeError) as e:
                print(
                    f"[search] ytmusicapi songs failed for query={args.query!r}: {type(e).__name__}: {e}",
                    file=sys.stderr,
                )
            try:
                videos = videos_future.result() or []
            except (KeyError, TypeError, AttributeError) as e:
                print(
                    f"[search] ytmusicapi videos failed for query={args.query!r}: {type(e).__name__}: {e}",
                    file=sys.stderr,
                )
    except Exception as e:
        print(
            f"[search] thread pool failed for query={args.query!r}: {type(e).__name__}: {e}",
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
        print(
            f"[search] yt-dlp fallback failed for query={args.query!r}: {type(e).__name__}: {e}",
            file=sys.stderr,
        )

    tracks = [to_track_json_from_ytdlp(e) for e in entries if _ytdlp_usable(e)]
    print(
        f"[search] yt-dlp fallback returned {len(tracks)} entries for query={args.query!r}",
        file=sys.stderr,
    )
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
    (the up-next radio for that song). Falls back to charts when seed is
    missing or the lookup fails."""
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
            charts = yt.get_charts(country=args.country)
            for key in ('songs', 'trending', 'videos'):
                section = charts.get(key)
                if section and 'items' in section:
                    items = section['items']
                    break
        except Exception as e:
            print(f"recommended: charts fallback failed ({e})", file=sys.stderr)

    tracks = [to_track_json(t) for t in items if t.get('videoId')]
    json.dump(tracks, sys.stdout)

def cmd_artist(args):
    """Resolve a YT Music artist channelId to the artist profile + their
    top songs. The user clicks an artist name in a track row, which routes
    to /artist/<channelId>; this fills that page."""
    try:
        info = yt.get_artist(channelId=args.channel_id)
    except Exception as e:
        print(f"artist failed: {e}", file=sys.stderr)
        json.dump({"error": str(e)}, sys.stdout)
        return

    # Pull top tracks from search rather than yt.get_artist()['songs']: the
    # latter returns no duration_seconds OR length, while search returns
    # both. Search ranking ≈ artist top songs for the same artist anyway.
    songs = []
    artist_name = (info.get("name") or "").strip()
    if artist_name:
        try:
            results = yt.search(artist_name, filter="songs", limit=30)
            lowered = artist_name.lower()
            for e in results or []:
                if not e.get("videoId"):
                    continue
                # Only include results actually attributed to this artist.
                if not any((a.get("name") or "").lower() == lowered
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
        print(f"album failed: {e}", file=sys.stderr)
        json.dump({"error": str(e)}, sys.stdout)
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

def cmd_trending(args):
    """Best-effort 'top tracks today' from YT Music charts. Falls back to a
    generic search if the charts API shape changes (it has historically)."""
    items = []
    try:
        charts = yt.get_charts(country=args.country)
        for key in ('songs', 'trending', 'videos'):
            section = charts.get(key)
            if section and 'items' in section:
                items = section['items']
                break
    except Exception as e:
        print(f"trending: charts failed ({e}); falling back to search", file=sys.stderr)

    if not items:
        try:
            items = yt.search('top hits', filter='songs', limit=30)
        except Exception as e:
            print(f"trending: fallback search failed ({e})", file=sys.stderr)
            items = []

    tracks = [to_track_json(t) for t in items if t.get('videoId')]
    json.dump(tracks, sys.stdout)

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

    p_trending = sub.add_parser("trending", help="Top tracks (charts). Prints JSON.")
    p_trending.add_argument("--country", default="ZZ", help="2-letter country code, ZZ=global")

    p_info = sub.add_parser("info", help="Resolve a videoId to a direct stream URL. Prints JSON.")
    p_info.add_argument("video_id", nargs="?")

    p_rec = sub.add_parser("recommended", help="Up-next radio for a seed videoId. Prints JSON.")
    p_rec.add_argument("--seed", help="Seed videoId; missing falls back to charts")
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
    else:
        cmd_interactive()

if __name__ == "__main__":
    main()
