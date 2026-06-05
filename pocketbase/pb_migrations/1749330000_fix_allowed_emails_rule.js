/// <reference path="../pb_data/types.d.ts" />

// The original allowed_emails migration shipped with createRule:
//   @collection.allowed_emails.email = email
// which in PB v0.22 means "ALL rows in allowed_emails must match" — never
// true for a multi-row collection, so registration always 400'd.
//
// This migration corrects it to the "any-of" operator (?=), so any single
// matching row lets the create through. Existing deployments need this
// patch because the original migration won't re-run.

migrate((db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  users.createRule = "@collection.allowed_emails.email ?= email";
  return dao.saveCollection(users);
}, (db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  users.createRule = "@collection.allowed_emails.email = email";
  return dao.saveCollection(users);
});
