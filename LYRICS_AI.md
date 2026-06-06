# AI lyrics fallback (Claude)

**Status:** planned, not implemented yet. This file describes how the AI fallback would work and what's needed to wire it up.

The in-player Lyrics button currently has one path: ask Genius. If Genius has nothing, the sheet shows *"No lyrics found."* The plan is to add a second path — when Genius misses, ask Claude to generate the lyrics from the track's title + artist, and clearly mark the result as AI-generated.

## How it would work

1. User opens the Lyrics sheet on a track.
2. Server hits Genius first (the existing `/api/lyrics` flow).
3. If Genius returns `lyrics: null`, the same endpoint calls Claude with a prompt like:

   > Return the lyrics for the song *"\<title\>"* by *\<artist\>*. If you don't actually know them, reply with the single word `UNKNOWN` — do not invent lyrics.

4. Response shape gains a third `source`:
   ```
   { lyrics: string, source: 'genius' | 'ai-generated' | 'none', url: string | null }
   ```
5. When `source === 'ai-generated'`, the lyrics sheet:
   - Adds a vibrant **AI generated** pill next to the track title (similar to the *Coming soon* / *PC only* tags in Settings → Plugins).
   - Keeps the existing **Report incorrect lyrics** button (already wired to the Discord webhook via `/api/lyrics-report`). The report payload already includes the `source` field, so the Discord embed already shows whether it was Genius or AI when you receive a report.

## Required env var

Put your Anthropic API key into `apps/web/.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-…
```

`.env.example` already lists this var. Without it, the AI fallback silently doesn't fire — the lyrics endpoint behaves as it does today (Genius hit or "no lyrics").

Get the key from https://console.anthropic.com → **API Keys** → **Create key**. Pricing: pay-as-you-go; a lyrics-sized prompt is small (≪ 1¢ per request) — but if you ship the app to friends, **you** pay for their lookups since the key sits in your `.env.local`.

## Implementation notes (for when we build it)

- The call lives in [`apps/web/app/api/lyrics/route.ts`](apps/web/app/api/lyrics/route.ts) — only invoke Claude when the Genius path returned `null`, so we don't double-bill.
- Use the official SDK: `npm install @anthropic-ai/sdk` (workspace `apps/web`).
- Model: `claude-haiku-4-5-20251001` is plenty for this task — fast + cheap.
- Cache the same as Genius — in-memory `LYRICS_CACHE` in [`lib/sources/youtube.ts`](apps/web/lib/sources/youtube.ts), 1-hour TTL keyed by `artist::title`. The `source` field is part of the cached value so a stale "ai-generated" doesn't refetch from Genius.
- Refuse to invent: include the `UNKNOWN` instruction above; if Claude returns that string, return `source: 'none'` instead of an AI-generated string. Keeps the "no lyrics found" path honest.
- Surface label: existing `LyricsSheet` already has a header strip for the track. Drop a `<span>` next to the title when `data.source === 'ai-generated'` styled like the amber **PC only** plugin tag (`bg-amber-500 text-white text-[10px] uppercase tracking-widest`).

## Report button (already wired)

Independent of whether AI is on, the **Report incorrect lyrics** button at the bottom of the lyrics sheet POSTs to [`apps/web/app/api/lyrics-report/route.ts`](apps/web/app/api/lyrics-report/route.ts) with:

```json
{
  "trackTitle": "...",
  "trackArtist": "...",
  "source": "genius" | "ai-generated" | "none",
  "note": "user-typed description of what's wrong",
  "lyrics": "the lyrics text shown to them"
}
```

That endpoint forwards to the same Discord webhook as the bug-report button. Rate-limited to 5 reports per 10 minutes per user — enough for genuine corrections, blocks accidental double-clicks and spam. The embed in Discord shows the reporter's email, the song, the source label, and a `lyrics.txt` attachment with whatever they were looking at.
