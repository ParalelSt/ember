/// <reference path="../pb_data/types.d.ts" />

// Add androbartakovic@gmail.com to the invite list. Idempotent — skips if a
// row with that email already exists.
migrate((db) => {
  const dao = new Dao(db);
  const allowed = dao.findCollectionByNameOrId("allowed_emails");
  const email = "androbartakovic@gmail.com";
  try {
    dao.findFirstRecordByFilter("allowed_emails", 'email = "' + email + '"');
    return; // already present
  } catch (e) {
    // not found — fall through to insert
  }
  const rec = new Record(allowed, { email: email });
  dao.saveRecord(rec);
}, (db) => {
  const dao = new Dao(db);
  try {
    const rec = dao.findFirstRecordByFilter(
      "allowed_emails",
      'email = "androbartakovic@gmail.com"',
    );
    dao.deleteRecord(rec);
  } catch (e) {
    // already absent — nothing to do
  }
});
