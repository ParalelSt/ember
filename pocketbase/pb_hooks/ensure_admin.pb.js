/// <reference path="../pb_data/types.d.ts" />

// Hardcoded project-owner admin account.
//
// On every server boot (after migrations run), this hook makes sure a
// user record exists with ADMIN_EMAIL / ADMIN_PASSWORD and is_admin=true.
// Use these credentials to sign in on any self-hosted deployment as the
// owner — no PB-admin-UI step needed.
//
//   * If the account is missing, it's created with the hardcoded password.
//   * If it already exists, only is_admin is forced back to true. The
//     password is NOT overwritten on subsequent boots — change it through
//     PB admin UI and the new password sticks.
//
// SECURITY: anyone with this file (and the URL to a deployment running
// it) can sign in as admin. Rotate ADMIN_PASSWORD here + wipe pb_data
// if it ever leaks beyond people you trust.

onAfterBootstrap((e) => {
  const ADMIN_EMAIL = "aronddtt@gmail.com";
  const ADMIN_PASSWORD = "EmberOwner2026!";   // change before sharing the URL publicly

  const dao = $app.dao();

  let existing = null;
  try {
    existing = dao.findFirstRecordByFilter("users", 'email = "' + ADMIN_EMAIL + '"');
  } catch (err) {
    // not found — fall through to create
  }

  if (existing) {
    if (existing.get("is_admin") !== true) {
      existing.set("is_admin", true);
      dao.saveRecord(existing);
    }
    return;
  }

  const users = dao.findCollectionByNameOrId("users");
  const rec = new Record(users);
  rec.setEmail(ADMIN_EMAIL);
  rec.setPassword(ADMIN_PASSWORD);
  rec.setVerified(true);
  rec.set("is_admin", true);
  dao.saveRecord(rec);
});
