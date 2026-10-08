// Shared by ensure_login_requests.pb.js (the boot sweep and the cron), which
// load it with require. Plain CommonJS: PocketBase's JS engine runs it as it is.
//
// Housekeeping for QR sign-in requests. The Next routes decide expiry on
// their own clock (apps/web/lib/qrLogin/state.ts); this only tidies up:
//   * a pending row past its expiry becomes expired
//   * any row older than 30 days is deleted (it was the audit record)

/** PocketBase's own date format, which sorts as text. */
function pbDate(ms) {
  return new Date(ms).toISOString().replace("T", " ");
}

function sweep(app) {
  const dao = app.dao();
  const now = Date.now();
  let expired = 0;
  let deleted = 0;
  try {
    const stale = dao.findRecordsByFilter(
      "login_requests",
      "status = 'pending' && expires < {:now}",
      "",
      500,
      0,
      { now: pbDate(now) },
    );
    for (const r of stale) {
      r.set("status", "expired");
      dao.saveRecord(r);
      expired++;
    }
    const old = dao.findRecordsByFilter(
      "login_requests",
      "created < {:cutoff}",
      "",
      500,
      0,
      { cutoff: pbDate(now - 30 * 24 * 60 * 60 * 1000) },
    );
    for (const r of old) {
      dao.deleteRecord(r);
      deleted++;
    }
  } catch (err) {
    console.warn("[login_requests] sweep failed: " + err);
  }
  return { expired, deleted };
}

module.exports = { sweep, pbDate };
