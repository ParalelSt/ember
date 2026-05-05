import { Router } from 'express';
import { featured } from '../sources/jamendo.js';
import { searchTracks as youtubeSearch } from '../sources/youtube.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      // Empty query → Jamendo "featured" as the trending list.
      // Falls through to [] if Jamendo isn't configured.
      try {
        const tracks = await featured({ limit: 30 });
        return res.json({ tracks });
      } catch {
        return res.json({ tracks: [] });
      }
    }
    const tracks = await youtubeSearch(q, { limit: 30 });
    res.json({ tracks });
  } catch (e) {
    next(e);
  }
});

export default router;
