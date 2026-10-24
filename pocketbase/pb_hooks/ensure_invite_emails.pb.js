/// <reference path="../pb_data/types.d.ts" />

// Invite emails are stored lower-case.
//
// The sign-in page and check-email lower-case what the person types, and so
// does Ember's own Admin > Invites. PocketBase 0.22 compares emails as they
// are written: check-email's `email = "..."` and the users createRule
// `@collection.allowed_emails.email ?= email` are both case-sensitive. So an
// invite added in the PocketBase admin UI with a capital letter (SETUP.md
// sends the owner there) never matched: the person read "This email isn't on
// the invite list".
//
// Every save of an allowed_emails row (admin UI, the API, a migration) is
// lower-cased here, and on boot the rows already stored are brought in line.
// A row that lower-cases to an email already on the list is the same invite
// twice (the unique index would refuse it), so it goes. Idempotent: a list
// that is already lower-case is not touched.

// PocketBase runs each handler on its own, without this file's top-level
// names, so each one carries the two lines itself.
onModelBeforeCreate((e) => {
  const email = String(e.model.get("email") || "");
  if (email.trim().toLowerCase() !== email) e.model.set("email", email.trim().toLowerCase());
}, "allowed_emails");

onModelBeforeUpdate((e) => {
  const email = String(e.model.get("email") || "");
  if (email.trim().toLowerCase() !== email) e.model.set("email", email.trim().toLowerCase());
}, "allowed_emails");

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let rows;
  try {
    rows = dao.findRecordsByFilter("allowed_emails", "id != ''", "created", 0, 0);
  } catch (err) {
    console.log("[ensure_invite_emails] allowed_emails missing, skipping:", err);
    return;
  }

  const seen = {};
  for (const row of rows) {
    const email = String(row.get("email") || "");
    seen[email] = true;
  }

  let changed = 0;
  for (const row of rows) {
    const email = String(row.get("email") || "");
    const lower = email.trim().toLowerCase();
    if (lower === email) continue;
    // A failure here must not stop PocketBase from booting: warn and carry
    // on, the next boot tries again (bughunt X11).
    try {
      if (seen[lower]) {
        dao.deleteRecord(row);
      } else {
        row.set("email", lower);
        dao.saveRecord(row);
        seen[lower] = true;
      }
      changed++;
    } catch (err) {
      console.warn("[ensure_invite_emails] could not lower-case an invite: " + err);
    }
  }
  if (changed > 0) console.log("[ensure_invite_emails] lower-cased " + changed + " invite email(s)");
});
