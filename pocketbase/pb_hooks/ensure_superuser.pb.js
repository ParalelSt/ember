/// <reference path="../pb_data/types.d.ts" />

// Hardcoded PocketBase super-admin (the /_/ admin-UI login).
//
// On every server boot this hook makes sure a super-admin record exists
// with SU_EMAIL / SU_PASSWORD below, AND that the password matches the
// hardcoded value. If the credentials were ever changed via the PB admin
// UI, the next boot resets them back.
//
// Why: the Next server signs into PB as super-admin (via the env-var
// creds in apps/web/.env.local) to read the allow-list. Keeping the
// credentials hardcoded + auto-reset means a fresh deployment "just
// works" once you copy .env.example to .env.local — no manual /_/
// account-creation step.
//
// Friends self-hosting can swap SU_EMAIL / SU_PASSWORD to their own
// values; they'd then update apps/web/.env.local to match.

onAfterBootstrap((e) => {
  const SU_EMAIL = "admin@ember.com";
  const SU_PASSWORD = "egKa5WNMx3QpuG7";

  const dao = $app.dao();
  let admin = null;
  try {
    admin = dao.findAdminByEmail(SU_EMAIL);
  } catch (err) {
    // Not found — create.
  }

  if (!admin) {
    admin = new Admin();
    admin.email = SU_EMAIL;
  }
  admin.setPassword(SU_PASSWORD);
  dao.saveAdmin(admin);
});
