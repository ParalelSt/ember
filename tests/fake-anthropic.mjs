/** Fake Anthropic API + Discord webhook for the UI test.
 *
 *      node tests/fake-anthropic.mjs &
 *
 *  Ports: FAKE_ANTHROPIC_PORT (4311), FAKE_DISCORD_PORT (4312).
 *  ai-triage.test.mjs runs its own fakes in-process and doesn't need this.
 *
 *  Both servers also answer GET with the last POST they received (as JSON:
 *  `{ prompt, headers }` for Anthropic, `{ body }` for Discord) — the UI test
 *  runs in a separate process from this one, so that's how it inspects what
 *  the real route actually sent without adding assertions here. */
import http from 'node:http';

const ANTHROPIC_PORT = Number(process.env.FAKE_ANTHROPIC_PORT ?? 4311);
const DISCORD_PORT = Number(process.env.FAKE_DISCORD_PORT ?? 4312);

const TRIAGE = {
  summary: 'Playback stops a few seconds into every track.',
  likelyCause: 'The stream proxy is returning 403 from YouTube on expired URLs, and the client gives up after three retries.',
  area: 'streaming',
  severity: 'high',
  confidence: 'medium',
  nextSteps: [
    'Update yt-dlp on the host',
    'Check the cookies.txt path in .env.local',
    'Look for 403s in logs/errors-*.jsonl',
  ],
  reproduction: 'Play any track and wait a few seconds for it to cut out.',
};

let lastAnthropic = null;
http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(lastAnthropic));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let prompt = null;
    try {
      prompt = JSON.parse(body || '{}')?.messages?.[0]?.content ?? null;
    } catch {
      // leave prompt null; the response below still goes out
    }
    lastAnthropic = { prompt, headers: req.headers };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(TRIAGE) }] }));
  });
}).listen(ANTHROPIC_PORT, '127.0.0.1', () => console.log(`fake anthropic on ${ANTHROPIC_PORT}`));

let lastDiscordBody = null;
http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ body: lastDiscordBody }));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    lastDiscordBody = Buffer.concat(chunks).toString('utf8');
    res.writeHead(204);
    res.end();
  });
}).listen(DISCORD_PORT, '127.0.0.1', () => console.log(`fake discord on ${DISCORD_PORT}`));
