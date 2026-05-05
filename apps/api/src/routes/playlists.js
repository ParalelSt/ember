import { Router } from 'express';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await req.db
      .from('playlists')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ playlists: data });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const { data, error } = await req.db
      .from('playlists')
      .insert({ name, user_id: req.user.id })
      .select('id, name, created_at')
      .single();
    if (error) throw error;
    res.status(201).json({ playlist: data });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { data: playlist, error: pErr } = await req.db
      .from('playlists')
      .select('id, name, created_at')
      .eq('id', req.params.id)
      .single();
    if (pErr) throw pErr;
    const { data: items, error: iErr } = await req.db
      .from('playlist_tracks')
      .select('position, track:tracks(*)')
      .eq('playlist_id', req.params.id)
      .order('position');
    if (iErr) throw iErr;
    res.json({ playlist, tracks: items.map(i => i.track) });
  } catch (e) { next(e); }
});

router.post('/:id/tracks', async (req, res, next) => {
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
    const { data: maxRow } = await req.db
      .from('playlist_tracks')
      .select('position')
      .eq('playlist_id', req.params.id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = (maxRow?.position ?? -1) + 1;
    const { error } = await req.db.from('playlist_tracks').insert({
      playlist_id: req.params.id,
      track_id: track.id,
      position,
    });
    if (error) throw error;
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id/tracks/:trackId', async (req, res, next) => {
  try {
    const { error } = await req.db
      .from('playlist_tracks')
      .delete()
      .eq('playlist_id', req.params.id)
      .eq('track_id', req.params.trackId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await req.db.from('playlists').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
