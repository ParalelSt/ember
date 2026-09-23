# 09. Admin > Users unusable at 390px

**What you'd notice:** open Admin > Users on a phone and every row is squashed
onto one line: the email shrinks to a sliver like "voic…" and the name box to
one letter.

**Why it happened:** the row always used the same 6-column desktop layout
(avatar, email, name box, admin toggle, two buttons), so on a narrow screen
those columns got squeezed down to a few pixels each instead of the phone
getting its own layout.

**What changed:** below the tablet breakpoint the row now stacks: avatar and
email on top, the name box full width under it, then the admin toggle and
the two action buttons on one line. The desktop 6-column layout is untouched
above that breakpoint. Files: `apps/web/app/(app)/admin/users/page.tsx`.

**Compare:** before = `9d0dad2`, after = `2428c44`.
- Test: `node tests/layout-w09-admin-users.test.mjs`: before, 4/6 pass, with
  `390px: row is not squeezed into the 6-column desktop grid: cols=6` and
  `390px: the email isn't clipped to a sliver: scrollWidth=192 clientWidth=42`
  failing; after, 6/6 pass.
- Screenshots: shots/09-before.png vs shots/09-after.png
- Try it yourself: sign in as an admin, resize the browser (or open on a
  phone) to 390px wide, go to Admin > Users.

**Risk:** low, layout-only change to one admin page.
