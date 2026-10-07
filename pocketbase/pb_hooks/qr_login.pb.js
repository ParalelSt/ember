/// <reference path="../pb_data/types.d.ts" />

// QR sign-in: the two things only PocketBase can do, for the Next server.
//
//   POST /api/ember/qr-login/mint        { request } -> { token, record }
//   POST /api/ember/qr-login/revoke-all  { user }    -> { ok: true }
//
// PocketBase 0.22 has no impersonate endpoint, so the Next status route
// (apps/web/app/api/auth/qr/status), once it has checked the poll secret,
// asks this hook to mint a session for an approved login request. The hook
// claims the request (approved -> used) and mints in ONE transaction, so
// however many Next processes poll at once, a request is minted once. It
// mints only for the member who approved, and only while the request is
// approved and unexpired. revoke-all rotates the member's token key, so
// every session of theirs (minted or password) dies at once.
//
// Both routes require a SUPERUSER token ($apis.requireAdminAuth): a member's
// token, even an is_admin member's, is refused. The public /pb proxy never
// forwards /api/ember/* either (proxy.ts and next.config.ts), so only the
// Next server's admin client reaches them. Nothing here logs the token.

routerAdd("POST", "/api/ember/qr-login/mint", (c) => {
  const data = $apis.requestInfo(c).data || {};
  const id = String(data.request || "");
  const notFound = () => c.json(404, { code: 404, message: "No such sign-in request.", data: {} });
  if (!/^[a-z0-9]{15}$/.test(id)) return notFound();

  // Same rule as apps/web/lib/qrLogin/state.ts DELIVER_GRACE_MS.
  const GRACE_MS = 30000;
  let result = { code: 404 };
  $app.dao().runInTransaction((tx) => {
    let row = null;
    try {
      row = tx.findRecordById("login_requests", id);
    } catch (_) {
      return;
    }
    const status = row.getString("status");
    if (status !== "approved") {
      result = { code: 409, status: status };
      return;
    }
    const expires = Date.parse(row.getString("expires").replace(" ", "T"));
    if (!(Date.now() < expires + GRACE_MS)) {
      row.set("status", "expired");
      tx.saveRecord(row);
      result = { code: 409, status: "expired" };
      return;
    }
    let user = null;
    try {
      user = tx.findRecordById("users", row.getString("user"));
    } catch (_) {
      row.set("status", "expired");
      tx.saveRecord(row);
      return;
    }
    const token = $tokens.recordAuthToken($app, user);
    row.set("status", "used");
    row.set("used_at", new Date().toISOString());
    // For per-device sign-out later: a hash of the session, never the session.
    row.set("minted_hash", $security.sha256(token));
    tx.saveRecord(row);
    // The same record copy authWithPassword answers with: the member's own
    // email included, hidden fields (password hash, token key) left out.
    user.ignoreEmailVisibility(true);
    result = { code: 200, token: token, record: user };
  });

  if (result.code === 200) return c.json(200, { token: result.token, record: result.record });
  if (result.code === 409) {
    return c.json(409, { code: 409, message: "This sign-in request cannot be used.", data: { status: result.status } });
  }
  return notFound();
}, $apis.requireAdminAuth());

routerAdd("POST", "/api/ember/qr-login/revoke-all", (c) => {
  const data = $apis.requestInfo(c).data || {};
  const id = String(data.user || "");
  let record = null;
  if (/^[a-z0-9]{15}$/.test(id)) {
    try {
      record = $app.dao().findRecordById("users", id);
    } catch (_) {
      record = null;
    }
  }
  if (!record) return c.json(404, { code: 404, message: "No such user.", data: {} });

  record.refreshTokenKey();
  $app.dao().saveRecord(record);
  return c.json(200, { ok: true });
}, $apis.requireAdminAuth());
