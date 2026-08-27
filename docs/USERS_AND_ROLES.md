# Creating users and assigning roles

Roles **cannot** be assigned through the app. `user_roles` is read-own-only, so no
account can promote itself — that is deliberate. The design this replaced read
`auth.users.raw_user_meta_data`, which a user can write to, meaning anyone could make
themselves admin. Assignment is therefore an operator action in the SQL editor.

## Step 1 — create the auth user

Supabase Dashboard → **Authentication → Users → Add user → Create new user**

- enter email + password
- tick **Auto Confirm User** — without it the account cannot sign in until the
  confirmation email is clicked, and the app will just say "Invalid login credentials"

Repeat for each account. Suggested set:

| Email | Password | Role |
|---|---|---|
| `admin@swadhikaar.in` | your choice | admin |
| `doctor@swadhikaar.in` | your choice | doctor |
| `asha@swadhikaar.in` | your choice | asha |

Use a real address you control for at least one of them, so password reset works.

## Step 2 — assign the roles

Dashboard → **SQL Editor** → paste and run:

```sql
select public.grant_app_role('admin@swadhikaar.in',  'admin');
select public.grant_app_role('doctor@swadhikaar.in', 'doctor');
select public.grant_app_role('asha@swadhikaar.in',   'asha', 'Rampur', 'Muzaffarpur');
```

Each returns a line telling you what it did, e.g.
`OK: asha@swadhikaar.in -> asha. scoped to Rampur, Muzaffarpur`

The village argument on `asha` is **not optional in practice**. RLS scopes a field
worker to their assigned villages, so an ASHA with no `field_worker_areas` row sees
zero patients — which reads as "the app is broken" rather than "the wiring is
incomplete". The function warns you if you omit it.

`doctor` gets a `doctors` row created and linked automatically. A doctor only sees
patients whose `assigned_doctor_id` is theirs, plus anyone in the unclaimed triage
pool (open escalation, nobody assigned).

## Step 3 — verify before you try to log in

```sql
select * from public.app_users_overview order by role;
```

Expect one row per user with a non-null `role`. An ASHA should show a village. A
doctor should show `has_doctor_row = true`. If `role` is null the account exists but
has no role, and the app will drop it to the patient portal.

## Where each role lands after login

| Role | Landing page |
|---|---|
| admin | `/admin/dashboard` |
| doctor | `/doctor/dashboard` |
| asha | `/asha/dashboard` |
| patient | `/patient/dashboard` |
| *no role* | `/patient/dashboard` (fallback) |

Routes are auth-gated but not role-gated, so an admin can open `/doctor/patients`
directly. RLS still decides what data loads.

## Forgotten password

Dashboard → Authentication → Users → the row's **⋮** menu → **Reset password** sends
a recovery email, or **Update user** sets one directly. The app itself has no
"forgot password" screen — worth adding before real ASHAs use it.

## If nobody can log in, check the key before the password

Sign-in returning 401 for every account, with the page saying *"This page is out of
date"*, is not a password problem — that message is what `humanError()` shows for any
API-key error. It happened once already: `frontend/.env.local` held the **legacy JWT
anon key** (`eyJhbGciOi...`), which is disabled on this project, while the backend had
already moved to the publishable key.

Correct value is the `sb_publishable_...` key from Dashboard → Project Settings → API
keys. See `frontend/.env.example`. Restart `next dev` afterwards —
`NEXT_PUBLIC_*` values are inlined at build time, so editing `.env.local` under a
running server changes nothing.

## If you delete users

Deleting an auth user cascades. `user_roles`, `field_worker_areas`, and the
`auth_user_id` links on `doctors` and `patients` all go with it (`ON DELETE CASCADE` /
`SET NULL`). Patient clinical records survive — `patients` rows are not tied to an
auth account — but the login links do not. Re-run `grant_app_role` after recreating
an account.
