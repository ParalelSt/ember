/** The desktop shell's injected logger, run in a fake webview.
 *
 *      node tests/desktop-logger.test.mjs   # or: npm run test:desktop-logger
 *
 *  No Tauri, no build — the script is extracted straight out of lib.rs and
 *  evaluated against stubs, so this runs anywhere in milliseconds.
 *
 *  The incident it guards: invoke() returns a promise, and a rejected one
 *  ("Command log_event not allowed by ACL") fired unhandledrejection, which
 *  the logger logged, which invoked again — a loop that filled the 200-entry
 *  buffer with one repeated error. A real bug report came back containing 400
 *  copies of it and nothing else, so the actual problem was invisible.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const LIB = 'apps/desktop/src-tauri/src/lib.rs';
const src = fs.readFileSync(LIB, 'utf8');
const start = src.indexOf('const APP_LOG_SCRIPT: &str = r#"');
const body = src.slice(src.indexOf('"', start + 30) + 1);
const SCRIPT = body.slice(0, body.indexOf('"#;'));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** A webview where every invoke is refused, exactly like the ACL denial. */
function makeWebview({ rejectInvokes = true } = {}) {
  const invokes = [];
  const listeners = {};
  const timers = new Set();
  const win = {
    __TAURI_INTERNALS__: {
      invoke: (cmd, args) => {
        invokes.push({ cmd, args });
        return rejectInvokes
          ? Promise.reject(new Error('Command log_event not allowed by ACL'))
          : Promise.resolve();
      },
    },
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    location: { href: 'https://ember.example.ts.net/' },
    fetch: () => Promise.resolve({ ok: true, status: 200 }),
  };
  const ctx = {
    window: win,
    // The script reads bare `location` and patches `window.fetch`, so the
    // stub needs both spellings a browser would provide.
    location: win.location,
    console: { error: () => {}, warn: () => {}, log: () => {} },
    setInterval: (fn) => { const id = setInterval(fn, 5); timers.add(id); return id; },
    clearInterval: (id) => { clearInterval(id); timers.delete(id); },
    setTimeout,
    Array, Error, String, JSON, Promise,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  return { ctx, win, invokes, listeners, stop: () => timers.forEach(clearInterval) };
}

const tick = () => new Promise((r) => setTimeout(r, 60));

// ── a refused invoke must not become an unhandled rejection ───────────────
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));

const a = makeWebview();
await tick();                       // let the bridge-detect interval fire
a.ctx.console.error('playback exploded');
await tick();
check('A1 the logger forwarded the error', a.invokes.length >= 1, `${a.invokes.length} invoke(s)`);
check('A2 a refused invoke raises NO unhandled rejection', unhandled.length === 0,
  `${unhandled.length} unhandled`);

// ── the same message must not repeat forever ──────────────────────────────
const before = a.invokes.length;
for (let i = 0; i < 50; i++) a.ctx.console.error('playback exploded');
await tick();
check('A3 fifty identical errors send at most once more', a.invokes.length - before <= 1,
  `${a.invokes.length - before} extra invoke(s)`);

// ── an error raised BY the logging path must not recurse ──────────────────
const b = makeWebview();
await tick();
let depth = 0, maxDepth = 0;
b.win.__TAURI_INTERNALS__.invoke = () => {
  depth++; maxDepth = Math.max(maxDepth, depth);
  try {
    b.ctx.console.error('secondary failure while logging');   // re-entrant
    return Promise.reject(new Error('nope'));
  } finally { depth--; }
};
b.ctx.console.error('first failure');
await tick();
check('B1 logging never re-enters itself', maxDepth <= 1, `depth reached ${maxDepth}`);

// ── distinct messages still get through ───────────────────────────────────
const c = makeWebview({ rejectInvokes: false });
await tick();
c.ctx.console.error('first thing');
c.ctx.console.error('second thing');
c.ctx.console.error('third thing');
await tick();
const msgs = c.invokes.map((i) => i.args?.message).filter(Boolean);
check('C1 different messages are all forwarded',
  ['first thing', 'second thing', 'third thing'].every((m) => msgs.some((x) => x.includes(m))),
  msgs.join(' | ').slice(0, 90));

a.stop(); b.stop(); c.stop();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
