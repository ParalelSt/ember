/** Title and artist guessed from a song's file name, the way the upload
 *  form pre-fills them: "Artist - Title.mp3" splits on the first " - ",
 *  anything else is all title. */
export function guessFromFilename(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '');
  const dash = base.split(/\s+-\s+/);
  return dash.length >= 2
    ? { artist: dash[0].trim(), title: dash.slice(1).join(' - ').trim() }
    : { artist: '', title: base };
}
