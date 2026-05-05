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
    album = (t.get("album") or {}).get("name")
    thumbs = t.get("thumbnails") or []
    artwork = thumbs[-1].get("url") if thumbs else None
    return {
        "videoId": t.get("videoId"),
        "title": t.get("title"),
        "artist": artist,
        "album": album,
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

    args = parser.parse_args()

    if args.cmd == "search":
        cmd_search(args)
    elif args.cmd == "download":
        cmd_download(args)
    elif args.cmd == "trending":
        cmd_trending(args)
    else:
        cmd_interactive()

if __name__ == "__main__":
    main()
