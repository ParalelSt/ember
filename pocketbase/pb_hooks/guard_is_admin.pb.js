/// <reference path="../pb_data/types.d.ts" />

// Only a PocketBase admin may grant or remove the admin role.
//
// users keeps PocketBase's owner-can-update rule, because /api/profile (and
// the theme, privacy and plugin settings) save the member's own record with
// their own session. That rule covers every field, is_admin included, and the
// sign-up rule only checks the invite list. Without this guard a member could
// flip is_admin on their own record, or sign up with it already set.
//
// The app's Admin > Users screen writes with the server's admin credentials
// (createAdminClient), so it passes; ensure_admin writes through the dao, not
// a request, so these hooks never see it.

onRecordBeforeCreateRequest((e) => {
  if ($apis.requestInfo(e.httpContext).admin) return;
  if (e.record.getBool("is_admin")) {
    throw new ForbiddenError("Only an admin can make someone an admin.");
  }
}, "users");

onRecordBeforeUpdateRequest((e) => {
  if ($apis.requestInfo(e.httpContext).admin) return;
  if (e.record.getBool("is_admin") !== e.record.originalCopy().getBool("is_admin")) {
    throw new ForbiddenError("Only an admin can change who is an admin.");
  }
}, "users");
