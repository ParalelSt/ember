/** The filter check behind pocketbase/pb_hooks/guard_filters.pb.js
 *  (security audit 2026-09-25, finding S1). No server, no PocketBase:
 *
 *      node tests/pb-filter-guard.test.mjs   # or: npm run test:pb-filter-guard
 *
 *  tests/pb-rbac.test.mjs proves the hook against a real PocketBase; this
 *  walks the edge cases of the parser itself. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { unsafeQueryExpr, unsafeSubscription, stripStrings } = require('../pocketbase/pb_hooks/lib/filterGuard.js');

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const refuses = (expr) => unsafeQueryExpr(expr) !== '';

// Refused: joins of every spelling.
for (const expr of [
  'likes_via_track.user = "abc"',
  'plays_via_track.user ?= "abc"',
  'LIKES_VIA_TRACK.user = "abc"',
  'uploader.name ~ "a"',
  'uploader.playlists_via_user.name ?~ "Diary"',
  '-uploader.name',
  'created,-uploader.name',
  '(uploader.is_admin=true)',
  'id!=""&&uploader.name="x"',
  'title = "a\\" b" && uploader.name = "x"',
  "title = 'it\\'s' && owner.name = 'x'",
  'job.user.name = "x"',
  'session.host = "abc"',
]) {
  check(`refuses ${expr}`, refuses(expr), unsafeQueryExpr(expr));
}
check('refuses an unclosed quote', refuses('title = "abc && uploader.name = x'));

// Allowed: what the app sends.
for (const expr of [
  '',
  null,
  undefined,
  'user = "abc123"',
  'user = "abc" && track = "def"',
  'playlist = "abc"',
  'target = "abc" && status = "pending"',
  '(shared = true || user = "me")',
  'song_key ~ "hello::" || song_key = ""',
  'played_at >= "2026-09-25 10:00:00.000Z"',
  'title = "a.b.c"',
  "artist ~ 'Mr. Brightside'",
  '-played_at',
  '-liked_at,-created',
  'duration_sec > 1.5',
  '@request.auth.id != "" && user = @request.auth.id',
  '@request.data.user:isset = false',
  'tags:length > 1',
]) {
  check(`allows ${JSON.stringify(expr)}`, !refuses(expr), unsafeQueryExpr(expr));
}

check('stripStrings keeps the structure', stripStrings('a = "x.y" && b = \'z\'') === 'a =  ""  && b =  "" ');

// Realtime topics.
const topic = (query) => `tracks/*?options=${encodeURIComponent(JSON.stringify({ query }))}`;
check('subscription without options is fine', unsafeSubscription('pranks/*') === '');
check('subscription with a plain filter is fine', unsafeSubscription(topic({ filter: 'target = "a" && status = "pending"' })) === '');
check('subscription with a join is refused', unsafeSubscription(topic({ filter: 'likes_via_track.user = "a"' })) !== '');
check('subscription with a joined sort is refused', unsafeSubscription(topic({ sort: 'uploader.name' })) !== '');
check('a second options value is checked too',
  unsafeSubscription(`${topic({ filter: 'id != ""' })}&options=${encodeURIComponent(JSON.stringify({ query: { filter: 'uploader.name = "x"' } }))}`) !== '');
check('unreadable options are refused', unsafeSubscription('tracks/*?options=%7Bnot-json') !== '');
check('headers-only options are fine', unsafeSubscription(`tracks/*?options=${encodeURIComponent('{"headers":{"x":"y"}}')}`) === '');

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
