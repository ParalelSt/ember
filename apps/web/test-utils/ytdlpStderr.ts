/** What `player.py download -- 0LYiIUMeO1o` really printed to stderr on
 *  2026-09-30 (yt-dlp 2026.08.19), with the host's paths shortened to
 *  /srv/ember. A radio song from a real report: ytmusicapi still lists it,
 *  but YouTube answers "This video is not available". Exit code 1, nothing
 *  on stdout. */
export const YTDLP_NOT_AVAILABLE_STDERR = `ERROR: [youtube] 0LYiIUMeO1o: This video is not available
Traceback (most recent call last):
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/YoutubeDL.py", line 1731, in wrapper
    return func(self, *args, **kwargs)
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/YoutubeDL.py", line 1866, in __extract_info
    ie_result = ie.extract(url)
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/extractor/common.py", line 765, in extract
    ie_result = self._real_extract(url)
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/extractor/youtube/_video.py", line 4076, in _real_extract
    self.raise_no_formats(reason, expected=True)
    ~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/extractor/common.py", line 1272, in raise_no_formats
    raise ExtractorError(msg, expected=expected, video_id=video_id)
yt_dlp.utils.ExtractorError: [youtube] 0LYiIUMeO1o: This video is not available

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/srv/ember/player.py", line 1351, in <module>
    main()
    ~~~~^^
  File "/srv/ember/player.py", line 1324, in main
    cmd_download(args)
    ~~~~~~~~~~~~^^^^^^
  File "/srv/ember/player.py", line 454, in cmd_download
    file_path = download_by_id(args.video_id)
  File "/srv/ember/player.py", line 341, in download_by_id
    return _download_with_403_retry(_attempt, lambda: _clean_partials(base))
  File "/srv/ember/player.py", line 207, in _download_with_403_retry
    return run()
  File "/srv/ember/player.py", line 329, in _attempt
    info = ydl.extract_info(url)
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/YoutubeDL.py", line 1720, in extract_info
    return self.__extract_info(url, self.get_info_extractor(key), download, extra_info, process)
           ~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/YoutubeDL.py", line 1749, in wrapper
    self.report_error(str(e), e.format_traceback())
    ~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/YoutubeDL.py", line 1165, in report_error
    self.trouble(f'{self._format_err("ERROR:", self.Styles.ERROR)} {message}', *args, **kwargs)
    ~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/YoutubeDL.py", line 1103, in trouble
    raise DownloadError(message, exc_info)
yt_dlp.utils.DownloadError: ERROR: [youtube] 0LYiIUMeO1o: This video is not available
`;

export const NOT_AVAILABLE_ID = '0LYiIUMeO1o';

/** What yt-dlp prints for an age-restricted video on a host that never signs
 *  in to YouTube (JuXvuM-xn5M, the desktop report of 2026-10-03), the ERROR
 *  line verbatim from the host's log, traceback shortened. Exit code 1. */
export const YTDLP_AGE_GATE_STDERR = `ERROR: [youtube] JuXvuM-xn5M: Sign in to confirm your age. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies
Traceback (most recent call last):
  File "/srv/ember/.venv/lib/python3.13/site-packages/yt_dlp/YoutubeDL.py", line 1103, in trouble
    raise DownloadError(message, exc_info)
yt_dlp.utils.DownloadError: ERROR: [youtube] JuXvuM-xn5M: Sign in to confirm your age. Use --cookies-from-browser or --cookies for the authentication.
`;

export const AGE_GATE_ID = 'JuXvuM-xn5M';
