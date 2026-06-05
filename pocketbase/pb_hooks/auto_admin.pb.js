/// <reference path="../pb_data/types.d.ts" />

// Project-owner auto-admin.
//
// When one of OWNER_EMAILS registers (anywhere this code runs — your
// machine, a friend's self-hosted copy, etc.), the new user record is
// saved with is_admin = true. No PB-admin-UI step needed; the owner is
// admin on every deployment automatically.
//
// Friends self-hosting can edit this file to add their own email so they
// auto-promote on their own copy. Each instance keeps its own list — your
// edits don't propagate to other deployments.

onRecordBeforeCreateRequest((e) => {
  const OWNER_EMAILS = [
    "aronddtt@gmail.com",
  ];
  const email = String(e.record.get("email") || "").toLowerCase().trim();
  if (OWNER_EMAILS.indexOf(email) !== -1) {
    e.record.set("is_admin", true);
  }
}, "users");
