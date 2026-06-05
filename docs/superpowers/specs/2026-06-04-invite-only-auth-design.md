# Invite-only auth — Design

## Goal

Convert Ember from "anyone can register" to invite-only. The project owner maintains a list of allow-listed emails. UX:

1. User enters their email.
2. If the email isn't on the list → reject.
3. If on the list and no account exists → password screen labelled **Register**.
4. If on the list and an account exists → password screen labelled **Log in**.

Same form, same field; only the label and the underlying action change.

## Scope locked

- **Allow-list storage:** new `allowed_emails` PocketBase collection, managed via the PB admin UI at `/_/`.
- **Enforcement:** PB `createRule` on `users` checks membership server-side; UI gating is informational only.
- **UI flow:** single page, two stages. Email field first, then password (label depends on PB lookup result).
- **No password-confirm field** on registration (matches the worded requirement).
- **No forgot-password / no email verification / no magic links** this round.

## Architecture

```
┌─ Stage 1: email ──────────────────────────┐    POST /api/auth/check-email
│  [email field] [Continue]                 │ ─────────────────────────────→  admin client →
└───────────────────────────────────────────┘                                  allowed_emails +
                  │                                                            users existence
                  │   { status: 'new'|'existing'|'denied' }                    │
                  │ ←─────────────────────────────────────────────────────────│
                  ▼
┌─ Stage 2 (status=new) ────────────────────┐    ┌─ Stage 2 (status=existing) ─┐
│  alice@example.com  (Not you?)            │    │  alice@example.com  (Not you?) │
│  [password field]                         │    │  [password field]              │
│  [Register]                               │    │  [Log in]                      │
└───────────────────────────────────────────┘    └────────────────────────────────┘
                  │                                                  │
                  │ existing AuthProvider.signUp()                  │ existing AuthProvider.signIn()
                  │  → PB users.create()                            │  → PB users.authWithPassword()
                  │  → PB createRule blocks if not on allow-list    │
                  ▼                                                  ▼
                                 [router.push(next)]

status=denied: stage 1 stays, inline error.
```

## File map

| File | Change |
|---|---|
| `pocketbase/pb_migrations/1749200000_allowed_emails.js` | **NEW.** Creates the collection, seeds the three emails, updates `users.createRule`. |
| `apps/web/lib/pocketbase/server.ts` | Add `createAdminClient()` helper that auths as the PB super-admin. |
| `apps/web/app/api/auth/check-email/route.ts` | **NEW.** POST endpoint that returns `{ status: 'new' \| 'existing' \| 'denied' }`. |
| `apps/web/proxy.ts` | Add `/api/auth/` to `PUBLIC_API_PREFIXES` so anon callers can reach `check-email`. |
| `apps/web/app/auth/page.tsx` | Rewrite as two-stage form. Mode toggle removed. |
| `apps/web/.env.example` | Document new `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` vars. |
| `SETUP.md` | Note the new admin creds requirement in the first-time flow. |

Nothing else touches: `AuthProvider`, `lib/api.ts`, route handlers other than the new one, zustand stores, PB collections other than `users` + `allowed_emails`.

## Component design

### Migration — `1749200000_allowed_emails.js`

```js
/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);

  const allowed = new Collection({
    name: "allowed_emails",
    type: "base",
    schema: [
      { name: "email", type: "email", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_allowed_emails_email` ON `allowed_emails` (`email`)",
    ],
    // Only the PB super-admin reads/writes via the admin UI. Anonymous
    // and per-user clients are blocked. Server route handlers query via
    // the admin client and bypass rules.
    listRule:   null,
    viewRule:   null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  dao.saveCollection(allowed);

  for (const email of [
    "luka29071@gmail.com",
    "mihajloentertainment@gmail.com",
    "aronddtt@gmail.com",
  ]) {
    const rec = new Record(allowed, { email });
    dao.saveRecord(rec);
  }

  const users = dao.findCollectionByNameOrId("users");
  users.createRule = "@collection.allowed_emails.email = email";
  dao.saveCollection(users);
}, (db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  users.createRule = "";
  dao.saveCollection(users);
  const allowed = dao.findCollectionByNameOrId("allowed_emails");
  dao.deleteCollection(allowed);
});
```

**Adding emails later:** PB admin → `allowed_emails` → New record. No restart, no code change.

### Admin client — `lib/pocketbase/server.ts`

```ts
/** Server-side admin client. Re-auths each call — cheap (~30ms) at the
 *  scale of "a couple of /api/auth/check-email hits per login session". */
export async function createAdminClient() {
  const pb = new PocketBase(PB_URL);
  const email = process.env.POCKETBASE_ADMIN_EMAIL;
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!email || !password) {
    const e = new Error('PocketBase admin credentials not configured');
    (e as { status?: number }).status = 503;
    throw e;
  }
  await pb.collection('_superusers').authWithPassword(email, password);
  return pb;
}
```

Uses the PB v0.22 `_superusers` API (not the deprecated `pb.admins`).

### Endpoint — `/api/auth/check-email/route.ts`

```ts
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const { email: raw } = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(raw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return jsonError('Invalid email', 400);

    const pb = await createAdminClient();

    const onList = await pb
      .collection('allowed_emails')
      .getFirstListItem(`email = "${escape(email)}"`)
      .catch((e) => (e?.status === 404 ? null : Promise.reject(e)));
    if (!onList) return Response.json({ status: 'denied' as const });

    const existing = await pb
      .collection('users')
      .getFirstListItem(`email = "${escape(email)}"`)
      .catch((e) => (e?.status === 404 ? null : Promise.reject(e)));

    return Response.json({ status: existing ? 'existing' : 'new' });
  } catch (e) {
    return fromError(e);
  }
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
```

### Proxy — `proxy.ts`

Add `'/api/auth/'` to `PUBLIC_API_PREFIXES`. The endpoint must work for anonymous callers (they're not signed in yet).

### Auth page — `app/auth/page.tsx`

Full rewrite (replaces the existing file):

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FlameIcon } from '@/components/icons';

type Stage =
  | { kind: 'email' }
  | { kind: 'password'; email: string; mode: 'new' | 'existing' };

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') ?? '/';

  const [stage, setStage] = useState<Stage>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const cleaned = email.trim().toLowerCase();
    if (!cleaned) return;
    setBusy(true);
    try {
      const r = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${r.status}`);
      }
      const { status } = (await r.json()) as { status: 'new' | 'existing' | 'denied' };
      if (status === 'denied') {
        setErr("This email isn't on the invite list. Ask the project owner to add you.");
        return;
      }
      setStage({ kind: 'password', email: cleaned, mode: status });
      setPassword('');
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (stage.kind !== 'password') return;
    setErr('');
    setBusy(true);
    try {
      const fn = stage.mode === 'existing' ? signIn : signUp;
      const result = await fn(stage.email, password);
      if (result.error) {
        setErr(result.error.message);
      } else {
        router.push(next);
        router.refresh();
      }
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setStage({ kind: 'email' });
    setErr('');
    setPassword('');
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklab,var(--ember)_18%,transparent),transparent_60%)]">
      <form
        onSubmit={stage.kind === 'email' ? submitEmail : submitPassword}
        className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-soft"
      >
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-3">
          <FlameIcon className="h-3.5 w-3.5 text-ember" />
          Ember
        </div>

        {stage.kind === 'email' ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Welcome</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter your invite email to continue.</p>
            <div className="mt-6 grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy} className="mt-6 w-full bg-ember hover:bg-ember-soft text-white">
              {busy ? '…' : 'Continue'}
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">
              {stage.mode === 'existing' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {stage.mode === 'existing' ? 'Enter your password to log in.' : 'Set a password to register.'}
            </p>
            <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-sm flex items-center justify-between">
              <span className="truncate">{stage.email}</span>
              <button type="button" onClick={back} className="text-xs text-muted-foreground hover:text-foreground shrink-0 ml-2">
                Not you?
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy} className="mt-6 w-full bg-ember hover:bg-ember-soft text-white">
              {busy ? '…' : stage.mode === 'existing' ? 'Log in' : 'Register'}
            </Button>
          </>
        )}

        {err && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}
      </form>
    </div>
  );
}
```

### Env vars — `.env.example`

```ini
# PocketBase super-admin (auto-created when you first opened /_/).
# Needed only by the /api/auth/check-email route so it can read
# allowed_emails. Both must be set; missing creds → /auth returns 503.
POCKETBASE_ADMIN_EMAIL=
POCKETBASE_ADMIN_PASSWORD=
```

### Setup doc

Add a sentence to **First time** in `SETUP.md`: after creating the PB admin account via `/_/`, paste those credentials into `apps/web/.env.local` as `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD`.

## Edge cases

| Case | Behavior |
|---|---|
| Two invitees race to register from the same email | PB's unique `users.email` index makes the second `create` fail. UI shows "email: already exists". User clicks "Not you?" → re-submits email → endpoint now returns `existing` → logs in normally. |
| Server creds missing | `createAdminClient` throws with `status: 503`. UI shows the upstream error in the inline banner. |
| Email casing mismatch | Migration seeds lowercased; endpoint and UI both lowercase before submission. PB users collection stores whatever the create call sent (also lowercased). All paths converge to lower. |
| User on the list deletes their account from PB admin | Allow-list entry stays. Next visit: `check-email` → `new` → register again. |
| Owner removes email from `allowed_emails` while user has an active session | Session keeps working (PB doesn't re-check `createRule` on existing records). Future re-registration after delete is blocked. Acceptable. |
| Direct POST to `/pb/api/collections/users/records` bypassing the UI | PB's `createRule` blocks. 400 from PB. |

## Verification

### 1. Migration ran cleanly

Open `http://127.0.0.1:8090/_/` after a PB restart that picked up the migration. Confirm:
- `allowed_emails` collection exists with three records: `luka29071@gmail.com`, `mihajloentertainment@gmail.com`, `aronddtt@gmail.com`.
- `users` collection → *API rules* → **Create rule** = `@collection.allowed_emails.email = email`.

### 2. Endpoint — denied path

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"random@nowhere.com"}'
```

Expect `{"status":"denied"}`.

### 3. Endpoint — new path

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"luka29071@gmail.com"}'
```

Expect `{"status":"new"}` before any user record for that email exists.

### 4. Endpoint — existing path

After registering one of the invited emails via the UI:

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"aronddtt@gmail.com"}'
```

Expect `{"status":"existing"}`.

### 5. UI walkthrough (manual)

| Step | Expect |
|---|---|
| `/auth`, random email, Continue | Inline error: "This email isn't on the invite list…" |
| `/auth`, `luka29071@gmail.com`, Continue | Stage 2 — title "Create your account", button **Register** |
| "Not you?" → stage 1 → registered email | Stage 2 — title "Welcome back", button **Log in** |
| Wrong password on Log in | Inline PB error |
| Correct password on Register / Log in | Redirect to `/` (or `?next=…`) |

### 6. Server-side enforcement (defence in depth)

```bash
curl -s -X POST http://127.0.0.1:3000/pb/api/collections/users/records \
  -H 'Content-Type: application/json' \
  -d '{"email":"randomperson@nowhere.com","password":"hunter2hunter2","passwordConfirm":"hunter2hunter2"}'
```

Expect a 400 — PB rule violation. Confirms the rule, not just the UI, is doing the gating.

## Out of scope

- Rate-limiting on `/api/auth/check-email`. Accepted risk: anyone with the URL can probe arbitrary emails and learn `denied | new | existing`. For an invite-only group of friends, this is fine; add later if abuse is observed.
- Forgot-password flow.
- Email verification.
- Magic-link / one-time-token first contact (Approach C in the brief).
- Multi-instance allow-list sync (each self-hosted Ember has its own list).
