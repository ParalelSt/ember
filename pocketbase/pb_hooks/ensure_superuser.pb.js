/// <reference path="../pb_data/types.d.ts" />

// PocketBase superuser (the /_/ admin-UI login), from the environment.
//
// The Next server signs in to PocketBase as this superuser with
// POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD from apps/web/.env.local,
// so the two must match. start-static.sh passes those same values to
// PocketBase as EMBER_PB_SUPERUSER_EMAIL / EMBER_PB_SUPERUSER_PASSWORD
// (unless those are set on their own), and on every boot this hook:
//
//   * env set: creates the superuser if missing, or sets its password to the
//     env value if it differs. Change the password in .env.local, restart,
//     and both sides move together.
//   * env unset: changes NOTHING, only logs a warning. An existing superuser
//     and its password are left exactly as they are, so a missing variable
//     can never lock the owner out.
//
// The credentials used to be hardcoded here and put back on every boot. The
// repo is public, so that password is public forever: see
// docs/reports/bughunt-2026-09-24/W14-pocketbase-admin-exposed.md.

onAfterBootstrap((e) => {
  const email = ($os.getenv("EMBER_PB_SUPERUSER_EMAIL") || "").trim();
  const password = $os.getenv("EMBER_PB_SUPERUSER_PASSWORD") || "";

  if (!email || !password) {
    console.warn(
      "[ensure_superuser] EMBER_PB_SUPERUSER_EMAIL / EMBER_PB_SUPERUSER_PASSWORD are not set: " +
        "leaving the PocketBase superuser as it is. Set POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD " +
        "in apps/web/.env.local and start with ./start-static.sh (see SETUP.md)."
    );
    return;
  }
  if (password.length < 10) {
    console.warn("[ensure_superuser] the superuser password must be at least 10 characters: nothing changed.");
    return;
  }
  // sha256 of the password this file used to hardcode. It is public, so a
  // host still using it is as good as open.
  if ($security.sha256(password) === "d868c375d45f5597eac595a4f7733aab0999a20b65de17d746f5bed7f7d623ac") {
    console.warn(
      "[ensure_superuser] WARNING: the superuser password is the old one from the public repo. " +
        "Change POCKETBASE_ADMIN_PASSWORD in apps/web/.env.local and restart."
    );
  }

  const dao = $app.dao();
  let admin = null;
  try {
    admin = dao.findAdminByEmail(email);
  } catch (err) {
    // Not found: create below.
  }

  // A failed save must not stop PocketBase from booting: warn and carry on.
  try {
    if (!admin) {
      admin = new Admin();
      admin.email = email;
      admin.setPassword(password);
      dao.saveAdmin(admin);
      console.log("[ensure_superuser] created the superuser " + email);
    } else if (!admin.validatePassword(password)) {
      // Only on a real change: setPassword also signs out every superuser
      // session, which a plain reboot shouldn't do.
      admin.setPassword(password);
      dao.saveAdmin(admin);
      console.log("[ensure_superuser] updated the superuser password for " + email);
    }
  } catch (err) {
    console.warn("[ensure_superuser] could not save the superuser " + email + ": " + err);
  }

  // Any other superuser is worth a look: after moving to a new email, the old
  // account (with the old, public password) is still there until deleted.
  const total = dao.totalAdmins();
  if (total > 1) {
    console.warn(
      "[ensure_superuser] " + total + " superusers exist. Open PocketBase's admin UI on the host " +
        "(http://127.0.0.1:<POCKETBASE_PORT>/_/, Settings > Admins) and delete any you don't recognise."
    );
  }
});
