/// <reference path="../pb_data/types.d.ts" />

// QR sign-in requests: creates the login_requests collection on boot if it
// does not exist yet (same zero-manual-setup pattern as ensure_sessions), and
// keeps its rules server-only.
//
// Security note: /pb is publicly proxied, so these RULES are the boundary.
// Every rule is null: only the server's admin client (the Next routes under
// app/api/auth/qr) reads or writes a request. A row holds hashes only, never
// the approve token or the poll secret themselves.
//
// The sweep (lib/loginRequests.js) runs once on boot and every 10 minutes.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  const find = (name) => {
    try {
      return dao.findCollectionByNameOrId(name);
    } catch (_) {
      return null;
    }
  };

  const users = find("users");
  if (!users) {
    console.log("[ensure_login_requests] users collection missing, skipping");
    return;
  }

  if (!find("login_requests")) {
    try {
      dao.saveCollection(new Collection({
        name: "login_requests",
        type: "base",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        indexes: [
          "CREATE UNIQUE INDEX idx_login_requests_code ON login_requests (code)",
          "CREATE UNIQUE INDEX idx_login_requests_token_hash ON login_requests (token_hash)",
          "CREATE INDEX idx_login_requests_user ON login_requests (user)",
        ],
        schema: [
          { name: "token_hash", type: "text", required: true, options: { max: 64 } },
          { name: "poll_hash", type: "text", required: true, options: { max: 64 } },
          { name: "code", type: "text", required: true, options: { min: 8, max: 8 } },
          { name: "status", type: "text", required: true, options: { max: 12 } },
          {
            name: "user",
            type: "relation",
            required: false,
            options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
          },
          { name: "device", type: "text", options: { max: 80 } },
          { name: "shell", type: "text", options: { max: 12 } },
          { name: "requester_ip", type: "text", options: { max: 64 } },
          { name: "approver_ip", type: "text", options: { max: 64 } },
          { name: "expires", type: "date", required: true, options: {} },
          { name: "approved_at", type: "date", options: {} },
          { name: "used_at", type: "date", options: {} },
          { name: "minted_hash", type: "text", options: { max: 64 } },
        ],
      }));
      console.log("[ensure_login_requests] created login_requests");
    } catch (err) {
      // A failed save must not stop PocketBase from booting (bughunt X11).
      console.warn("[ensure_login_requests] could not create login_requests: " + err);
      return;
    }
  }

  // Server-only, whatever an older install or a hand edit left behind.
  const col = find("login_requests");
  const rule = (r) => (r === null || r === undefined ? null : JSON.parse(JSON.stringify(r)));
  if (
    rule(col.listRule) !== null ||
    rule(col.viewRule) !== null ||
    rule(col.createRule) !== null ||
    rule(col.updateRule) !== null ||
    rule(col.deleteRule) !== null
  ) {
    col.listRule = null;
    col.viewRule = null;
    col.createRule = null;
    col.updateRule = null;
    col.deleteRule = null;
    try {
      dao.saveCollection(col);
      console.log("[ensure_login_requests] login_requests: server-only again");
    } catch (err) {
      console.warn("[ensure_login_requests] could not save login_requests: " + err);
    }
  }

  require(`${__hooks}/lib/loginRequests.js`).sweep($app);
});

cronAdd("login_requests_sweep", "*/10 * * * *", () => {
  require(`${__hooks}/lib/loginRequests.js`).sweep($app);
});
