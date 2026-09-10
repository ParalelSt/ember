/** Collection descriptor logic: one place for route, pin id, title and icon
 *  definitions so the sidebar, library pages, and offline view never disagree.
 *
 *      node tests/collections.test.mjs   # or: npm run test:collections
 *
 *  Framework-free so a plain Node test can import it. */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../apps/web/lib/collections.ts', import.meta.url), 'utf8');
const js = src
  .replace(/import\s+type\s+\{[^}]*\}\s+from\s+[^;]*;/g, '')
  .replace(/export\s+type\s+[^=]+=[\s\S]*?(?=\n(?:export|const|function|\n|$))/g, '')
  .replace(/export\s+interface\s+[^{]*\{[^}]*\}/g, '')
  .replace(/:\s*(?:readonly\s+)?(?:CollectionRef|SystemKind|CollectionIcon|PlaybackContext|number|string|boolean|void|null|undefined)(?:\[\])?(?:\s*\|\s*(?:CollectionRef|SystemKind|CollectionIcon|PlaybackContext|number|string|boolean|void|null|undefined))*(?=[,\s)\{=;])/g, '')
  .replace(/([a-zA-Z_][a-zA-Z0-9_]*)\?(?=\s*[,)=])/g, '$1')
  .replace(/\?:/g, ':')
  .replace(/\s+as\s+const\s+satisfies\s+Record<[^>]+>/g, '')
  .replace(/\s+as\s+(?:CollectionRef|SystemKind|readonly\s+string\[\])/g, '')
  .replace(/:\s*SystemCollection\[\]/g, '');
const c = await import(
  `data:text/javascript,${encodeURIComponent(js)}`
);

const out = [];
const check = (name, fn) => {
  try { fn(); out.push([name, true]); console.log(`PASS  ${name}`); }
  catch (e) { out.push([name, false]); console.log(`FAIL  ${name}  — ${e.message}`); }
};

check('hrefFor returns correct routes', () => {
  assert.equal(c.hrefFor({ kind: 'playlist', id: 'abc' }), '/playlist/abc');
  assert.equal(c.hrefFor({ kind: 'liked' }), '/library/liked');
  assert.equal(c.hrefFor({ kind: 'recent' }), '/library/recent');
  assert.equal(c.hrefFor({ kind: 'uploads' }), '/library/uploads');
});

check('pinIdFor returns correct pin ids', () => {
  assert.equal(c.pinIdFor({ kind: 'playlist', id: 'abc' }), 'abc');
  assert.equal(c.pinIdFor({ kind: 'liked' }), 'liked');
  assert.equal(c.pinIdFor({ kind: 'recent' }), 'recent');
  assert.equal(c.pinIdFor({ kind: 'uploads' }), 'uploads');
});

check('refFromPinId round-trips with pinIdFor', () => {
  const refs = [
    { kind: 'playlist', id: 'abc' },
    { kind: 'liked' },
    { kind: 'recent' },
    { kind: 'uploads' },
  ];
  for (const ref of refs) {
    const pinId = c.pinIdFor(ref);
    const roundTrip = c.refFromPinId(pinId);
    assert.deepEqual(roundTrip, ref);
  }
});

check('refFromPinId defaults unknown ids to playlist', () => {
  assert.deepEqual(c.refFromPinId('zzz'), { kind: 'playlist', id: 'zzz' });
});

check('titleFor returns correct titles', () => {
  assert.equal(c.titleFor({ kind: 'liked' }), 'Liked songs');
  assert.equal(c.titleFor({ kind: 'recent' }), 'Recently played');
  assert.equal(c.titleFor({ kind: 'uploads' }), 'Uploads');
  assert.equal(c.titleFor({ kind: 'playlist', id: 'abc' }, 'Road trip'), 'Road trip');
  assert.equal(c.titleFor({ kind: 'playlist', id: 'abc' }), 'Playlist');
});

check('iconFor returns correct icons', () => {
  assert.equal(c.iconFor({ kind: 'liked' }), 'heart');
  assert.equal(c.iconFor({ kind: 'recent' }), 'clock');
  assert.equal(c.iconFor({ kind: 'uploads' }), 'upload');
  assert.equal(c.iconFor({ kind: 'playlist', id: 'abc' }), null);
});

check('contextFor returns correct contexts', () => {
  assert.deepEqual(c.contextFor({ kind: 'liked' }), { type: 'liked' });
  assert.deepEqual(c.contextFor({ kind: 'recent' }), { type: 'history' });
  assert.deepEqual(c.contextFor({ kind: 'uploads' }), { type: 'uploads' });
  assert.deepEqual(c.contextFor({ kind: 'playlist', id: 'abc' }, 'Road trip'), {
    type: 'playlist',
    playlistId: 'abc',
    playlistName: 'Road trip',
  });
});

check('sameContext identifies matching collections', () => {
  const liked1 = { type: 'liked' };
  const liked2 = { type: 'liked' };
  const history = { type: 'history' };
  const playlist1 = { type: 'playlist', playlistId: 'abc', playlistName: 'Road trip' };
  const playlist2 = { type: 'playlist', playlistId: 'abc', playlistName: 'Road trip' };
  const playlist3 = { type: 'playlist', playlistId: 'xyz', playlistName: 'Other' };

  assert.equal(c.sameContext(liked1, liked2), true);
  assert.equal(c.sameContext(playlist1, playlist2), true);
  assert.equal(c.sameContext(playlist1, playlist3), false);
  assert.equal(c.sameContext(liked1, history), false);
  assert.equal(c.sameContext(null, liked1), false);
  assert.equal(c.sameContext(liked1, undefined), false);
  assert.equal(c.sameContext(null, undefined), false);
});

check('countLabel pluralizes correctly', () => {
  assert.equal(c.countLabel(1), '1 song');
  assert.equal(c.countLabel(7), '7 songs');
  assert.equal(c.countLabel(2, 'track'), '2 tracks');
});

check('systemCollections lists the correct kinds', () => {
  const sys = c.systemCollections();
  assert.equal(sys.length, 3);
  assert.deepEqual(sys[0].ref, { kind: 'liked' });
  assert.equal(sys[0].href, '/library/liked');
  assert.equal(sys[0].pinId, 'liked');
  assert.equal(sys[0].icon, 'heart');
  assert.deepEqual(sys[1].ref, { kind: 'recent' });
  assert.equal(sys[1].href, '/library/recent');
  assert.equal(sys[1].pinId, 'recent');
  assert.equal(sys[1].icon, 'clock');
  assert.deepEqual(sys[2].ref, { kind: 'uploads' });
  assert.equal(sys[2].href, '/library/uploads');
  assert.equal(sys[2].pinId, 'uploads');
  assert.equal(sys[2].icon, 'upload');
});

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
