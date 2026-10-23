/// <reference path="../pb_data/types.d.ts" />

// Deleting an account is server-only.
//
// PocketBase's default users rules let a member delete their own record, so
// through /pb a member could remove their account directly. The app has no
// self-delete: accounts are deleted by the admin route
// (app/api/admin/users/[id]), which first removes the member's private tabs
// and their files (deleteMember in lib/tabStore); a raw delete skipped that and left
// the files on disk with nobody able to see them. The privacy page asks
// members to contact the owner instead.
//
// Only deleteRule changes: the other users rules (own record only, the
// invite-gated sign-up) stay as they are. On every boot, like
// ensure_tracks_rules, so existing installs pick it up on their next
// PocketBase restart.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_users_rules] users collection missing, skipping:", err);
    return;
  }

  // Rules come back from Go as string pointers, so compare the JSON form
  // (same as ensure_tabs).
  const rule = (r) => (r === null || r === undefined ? null : JSON.parse(JSON.stringify(r)));
  if (rule(users.deleteRule) === null) return;

  users.deleteRule = null;
  // A failed save must not stop PocketBase from booting: warn and carry on,
  // same as ensure_superuser (bughunt X11).
  try {
    dao.saveCollection(users);
    console.log("[ensure_users_rules] accounts are deleted by the server only now");
  } catch (err) {
    console.warn("[ensure_users_rules] could not save the users collection: " + err);
  }
});
