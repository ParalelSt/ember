import { Router } from 'express';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await req.db
      .from('plays')
      .select('played_at, track:tracks(*)')
      .order('played_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const seen = new Set();
    const tracks = [];
    for (const row of data) {
      if (!row.track || seen.has(row.track.id)) continue;
      seen.add(row.track.id);
      tracks.push(row.track);
    }
    res.json({ tracks });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const track = req.body?.track;
    if (!track?.id) return res.status(400).json({ error: 'track required' });
    await req.db.from('tracks').upsert({
      id: track.id,
      source: track.source,
      source_id: track.sourceId,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration_sec: track.durationSec,
      artwork_url: track.artworkUrl,
      stream_url: track.streamUrl,
    });
    const { error } = await req.db
      .from('plays')
      .insert({ user_id: req.user.id, track_id: track.id });
    if (error) throw error;
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
