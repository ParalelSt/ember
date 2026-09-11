/** Device check: a native offline download failure must reach the WebView as a
 *  nativeLog plugin event (the Android side of bug reports).
 *
 *  Needs the phone emulator with the Ember APK installed and open, and the
 *  WebView DevTools socket forwarded:
 *      adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof app.ember.music)
 *      WS=$(curl -s http://127.0.0.1:9333/json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(p=>p.type==="page").webSocketDebuggerUrl))')
 *      node tests/android-native-log.mjs "$WS"
 *  Prints PASS/FAIL per check and exits non-zero on failure. */
const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id);
    pending.delete(d.id);
    d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result);
  }
};
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const check = (name, ok, detail = '') => { if (!ok) process.exitCode = 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
const hasPlugin = await evalJs('!!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.EmberOffline)');
check('EmberOffline plugin present in the WebView', hasPlugin);
if (!hasPlugin) process.exit(1);

await evalJs(`(async () => {
  window.__nativeSeen = [];
  await window.Capacitor.Plugins.EmberOffline.addListener('nativeLog', (e) => window.__nativeSeen.push(e));
  return true;
})()`);
// A pin whose only track cannot be downloaded: the service must fail it and
// the failure must surface as a nativeLog event.
const pinResult = await evalJs(`(async () => {
  try {
    const s = await window.Capacitor.Plugins.EmberOffline.pin({ id: 'devcheck', name: 'Device check', tracks: [
      { id: 'upload:devcheck-missing', source: 'upload', sourceId: 'devcheck-missing', title: 'Missing', artist: 'x',
        artistId: null, album: null, albumId: null, durationSec: 1, artworkUrl: null, streamUrl: '/api/uploads/devcheck-missing/stream' }
    ] });
    return JSON.stringify({ ok: true, pins: (s.pins || []).length });
  } catch (e) { return JSON.stringify({ ok: false, err: String(e && e.message || e) }); }
})()`);
check('pin() call accepted', JSON.parse(pinResult).ok, pinResult);
let seen = [];
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  seen = await evalJs('JSON.stringify(window.__nativeSeen || [])');
  seen = JSON.parse(seen);
  if (seen.some((e) => e.level === 'error')) break;
}
const errors = seen.filter((e) => e.level === 'error');
check('a nativeLog error event arrived for the failed download', errors.length > 0, JSON.stringify(seen).slice(0, 300));
check('the event names the offline category', errors.some((e) => e.category === 'offline'), errors.map((e) => e.category).join(','));
check('service lifecycle events arrived too', seen.some((e) => /service/i.test(e.message || '')), seen.map((e) => e.message).join(' | ').slice(0, 200));
await evalJs(`window.Capacitor.Plugins.EmberOffline.unpin({ id: 'devcheck' }).then(() => true).catch(() => false)`);
const status = await evalJs(`window.Capacitor.Plugins.EmberOffline.status().then((s) => JSON.stringify((s.pins || []).map((p) => p.id)))`);
check('test pin removed', !JSON.parse(status).includes('devcheck'), status);
ws.close();
process.exit(process.exitCode ?? 0);
