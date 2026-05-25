import os
import re
import sys
import json
import argparse
import contextlib
from pathlib import Path
from ytmusicapi import YTMusic
import yt_dlp

# ============= CONFIG =============
# MUSIC_DIR resolves relative to this script (not cwd) so the Express API can
# spawn it from any working directory. Override with the MUSIC_DIR env var.
MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", Path(__file__).parent / "my_music"))
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

yt = YTMusic()  # Works anonymously. For better results, use OAuth later.

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

def to_track_json(t):
    """Normalize a ytmusicapi search result into a flat JSON record."""
    artists = t.get("artists") or []
    artist = artists[0].get("name") if artists else "Unknown"
    artist_id = artists[0].get("id") if artists else None
    album_obj = t.get("album") or {}
    album = album_obj.get("name") if isinstance(album_obj, dict) else None
    album_id = album_obj.get("id") if isinstance(album_obj, dict) else None
    thumbs = t.get("thumbnails") or []
    artwork = thumbs[-1].get("url") if thumbs else None
    return {
        "videoId": t.get("videoId"),
        "title": t.get("title"),
        "artist": artist,
        "artistId": artist_id,
        "album": album,
        "albumId": album_id,
        "durationSec": t.get("duration_seconds") or 0,
        "artworkUrl": artwork,
    }

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
def cmd_search(args):
    results = yt.search(args.query, filter="songs", limit=args.limit)
    tracks = [to_track_json(t) for t in results]
    json.dump(tracks, sys.stdout)

def cmd_download(args):
    file_path = download_by_id(args.video_id)
    json.dump({"filePath": str(file_path.resolve())}, sys.stdout)

def cmd_info(args):
    """Resolve a videoId to a direct streamable URL (no download).
    Used by the API's stream-proxy mode so songs aren't saved to disk."""
    url = f"https://www.youtube.com/watch?v={args.video_id}"
    ydl_opts = {
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
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

    songs_section = info.get("songs") or {}
    songs = songs_section.get("results") or []

    # Some artists only expose the small "songs" list; fall back to a wider
    # search of their videos so we have more to play.
    if len(songs) < 5:
        try:
            extra = yt.search(info.get("name") or "", filter="songs", limit=30)
            seen_ids = {s.get("videoId") for s in songs}
            for e in extra or []:
                if not e.get("videoId") or e.get("videoId") in seen_ids:
                    continue
                # only include results actually attributed to this artist
                if not any((a.get("name") or "").lower() == (info.get("name") or "").lower()
                           for a in (e.get("artists") or [])):
                    continue
                songs.append(e)
        except Exception as e:
            print(f"artist: extra search failed: {e}", file=sys.stderr)

    albums = (info.get("albums") or {}).get("results") or []
    out = {
        "name": info.get("name"),
        "description": info.get("description"),
        "thumbnails": info.get("thumbnails") or [],
        "tracks": [to_track_json(t) for t in songs if t.get("videoId")],
        "albums": [
            {
                "browseId": a.get("browseId"),
                "title": a.get("title"),
                "year": a.get("year"),
                "thumbnails": a.get("thumbnails"),
            }
            for a in albums if a.get("browseId")
        ],
    }
    json.dump(out, sys.stdout)

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
    p_download.add_argument("video_id")

    p_trending = sub.add_parser("trending", help="Top tracks (charts). Prints JSON.")
    p_trending.add_argument("--country", default="ZZ", help="2-letter country code, ZZ=global")

    p_info = sub.add_parser("info", help="Resolve a videoId to a direct stream URL. Prints JSON.")
    p_info.add_argument("video_id")

    p_rec = sub.add_parser("recommended", help="Up-next radio for a seed videoId. Prints JSON.")
    p_rec.add_argument("--seed", help="Seed videoId; missing falls back to charts")
    p_rec.add_argument("--limit", type=int, default=30)
    p_rec.add_argument("--country", default="ZZ")

    p_artist = sub.add_parser("artist", help="Artist profile + top songs by channelId. Prints JSON.")
    p_artist.add_argument("channel_id")

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
    else:
        cmd_interactive()

if __name__ == "__main__":
    main()
