/// <reference path="../pb_data/types.d.ts" />

// QR sign-in: the two things only PocketBase can do, for the Next server.
//
//   POST /api/ember/qr-login/mint        { user }  -> { token, record }
//   POST /api/ember/qr-login/revoke-all  { user }  -> { ok: true }
//
// PocketBase 0.22 has no impersonate endpoint, so the Next status route
// (apps/web/app/api/auth/qr/status) asks this hook to mint a normal session
// token for the member who approved, once, after it has checked the request
// and the poll secret. revoke-all rotates the member's token key, so every
// session of theirs (minted or password) dies at once.
//
// Both routes require a SUPERUSER token ($apis.requireAdminAuth): a member's
// token, even an is_admin member's, is refused. The public /pb proxy never
// forwards /api/ember/* either (proxy.ts and next.config.ts), so only the
// Next server's admin client reaches them. Nothing here logs the token.

routerAdd("POST", "/api/ember/qr-login/mint", (c) => {
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

  const token = $tokens.recordAuthToken($app, record);
  // The same record copy authWithPassword answers with: the member's own
  // email included, hidden fields (password hash, token key) left out.
  record.ignoreEmailVisibility(true);
  return c.json(200, { token: token, record: record });
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
