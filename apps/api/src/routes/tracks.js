import { Router } from 'express';
import { getTrack } from '../sources/jamendo.js';

const router = Router();

router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const [source, sourceId] = id.includes(':') ? id.split(':') : ['jamendo', id];
    if (source !== 'jamendo') return res.status(404).json({ error: 'Unknown source' });
    const track = await getTrack(sourceId);
    if (!track) return res.status(404).json({ error: 'Not found' });
    res.json({ track });
  } catch (e) {
    next(e);
  }
});

export default router;
