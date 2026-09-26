/// <reference path="../pb_data/types.d.ts" />

// Project-owner app account, from the environment.
//
// On every boot (after migrations run), with EMBER_ADMIN_EMAIL set:
//
//   * If the account is missing, it's created with EMBER_ADMIN_PASSWORD and
//     is_admin = true, so a fresh deployment has an owner to sign in as.
//   * If it already exists, only is_admin is forced back to true. The
//     password is NEVER overwritten: change it in the app or the PB admin UI
//     and the new one sticks. EMBER_ADMIN_PASSWORD is only a first password.
//
// Unset EMBER_ADMIN_EMAIL: nothing happens but a warning. start-static.sh
// reads both from the environment or apps/web/.env.local.
//
// The email and first password used to be hardcoded here, in a public repo,
// exposing the admin password (bughunt W14). Fixed by reading both from env.

onAfterBootstrap((e) => {
  const email = ($os.getenv("EMBER_ADMIN_EMAIL") || "").trim();
  const password = $os.getenv("EMBER_ADMIN_PASSWORD") || "";

  if (!email) {
    console.warn("[ensure_admin] EMBER_ADMIN_EMAIL is not set: no owner account is created or checked.");
    return;
  }

  const dao = $app.dao();

  let existing = null;
  try {
    existing = dao.findAuthRecordByEmail("users", email);
  } catch (err) {
    // not found: fall through to create
  }

  if (existing) {
    if (existing.get("is_admin") !== true) {
      existing.set("is_admin", true);
      dao.saveRecord(existing);
    }
    return;
  }

  if (password.length < 10) {
    console.warn(
      "[ensure_admin] no account for " + email + " yet, and EMBER_ADMIN_PASSWORD is unset or under " +
        "10 characters: not creating it."
    );
    return;
  }
  // sha256 of the first password this file used to hardcode (public now).
  if ($security.sha256(password) === "d48eba869ccad9bc55dc0e14348f1afe70cf92d0dd8b295aec571eda372dee92") {
    console.warn("[ensure_admin] EMBER_ADMIN_PASSWORD is the old one from the public repo: not creating the account with it.");
    return;
  }

  // A failure here (say, the username is taken) must not stop PocketBase
  // from booting: warn and carry on.
  try {
    const users = dao.findCollectionByNameOrId("users");
    const rec = new Record(users);
    // PB v0.22 auth records need a username. The auto-generator only fires
    // for API-driven creates, not for `new Record()` from JSVM, so set it
    // explicitly to the email's local part.
    rec.set("username", email.replace(/@.+/, "").replace(/[^\w.-]/g, "_"));
    rec.setEmail(email);
    rec.setPassword(password);
    rec.setVerified(true);
    rec.set("is_admin", true);
    dao.saveRecord(rec);
    console.log("[ensure_admin] created the owner account " + email);
  } catch (err) {
    console.warn("[ensure_admin] could not create the owner account " + email + ": " + err);
  }
});
