import { Router } from 'express';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await req.db
      .from('likes')
      .select('created_at, track:tracks(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ tracks: data.map(d => d.track) });
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
      .from('likes')
      .insert({ user_id: req.user.id, track_id: track.id });
    if (error && error.code !== '23505') throw error;
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:trackId', async (req, res, next) => {
  try {
    const { error } = await req.db
      .from('likes')
      .delete()
      .eq('track_id', req.params.trackId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
