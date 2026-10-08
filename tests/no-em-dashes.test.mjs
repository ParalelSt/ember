/** Guard test: no tracked text file may contain an em dash (U+2014).
 *
 *      node tests/no-em-dashes.test.mjs      # or: npm run test:no-em-dashes
 *
 *  Needs no sandbox, only git. When a regex or assertion must mention the
 *  character on purpose, write it as the escape \u2014 instead of the glyph. */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EM_DASH = '\u2014';
const SKIP_NAMES = new Set(['package-lock.json']);
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|icns|svg|bmp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|jar|apk|aab|dmg|exe|msi|so|dylib|a|wasm|mp3|m4a|mp4|ogg|wav|flac|keystore|jks|db|sqlite|bin)$/i;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
};

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8').split('\0').filter(Boolean);

const hits = [];
let scanned = 0;
for (const rel of files) {
  if (SKIP_NAMES.has(path.basename(rel)) || SKIP_EXT.test(rel)) continue;
  let buf;
  try { buf = fs.readFileSync(path.join(ROOT, rel)); } catch { continue; } // deleted but still indexed
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  scanned++;
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((line, i) => { if (line.includes(EM_DASH)) hits.push(`${rel}:${i + 1}`); });
}

check('scanned tracked text files', scanned > 0, `${scanned} files`);
check('no tracked text file contains an em dash', hits.length === 0,
  hits.length ? `\n    ${hits.join('\n    ')}` : '');

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
assert.equal(failed.length, 0);
