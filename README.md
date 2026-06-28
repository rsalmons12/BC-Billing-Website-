# Recovery Desk — Web

Multi-tenant revenue cycle management (RCM) app for **BC Billing Solutions**, built on
**Next.js (App Router, TypeScript) + Supabase + Vercel**.

Data isolation between facilities is enforced by **Postgres Row-Level Security**, not by
the UI. Even a hand-crafted API call cannot read another facility's rows.

## Roles

| Role | Sees | Can edit |
| --- | --- | --- |
| `management` | Everything, all facilities, plus Admin | Yes |
| `staff` (collectors/billers) | Only assigned facilities | Yes, on those facilities |
| `facility` | Only its own one facility | No — read-only |
| `pending` | "Access not set up yet" page | No |

## Screens

- **Overview** (management) — network totals, per-facility breakdown, a High-Risk (65+ day)
  panel with worst offenders and Excel export.
- **Collections** (management + staff) — claims joined to the persistent collector layer
  (`claim_work`); editable status, flags, mgmt checkbox, notes, initials, date worked; bucket
  and worked/unworked filters; search. Setting **Auth = Y** routes the claim to the auth team.
- **Auth Issues** (management + staff) — the auth team's board. Completing an issue writes back
  to the source claim and copies the auth notes over.
- **Facility dashboard** (facility) — read-only ledger (charged vs recovered), open claims,
  auth-issue status, 65+ day risk summary.
- **Admin** (management) — manage users (role, facility, staff assignments via chip toggles),
  CRUD facilities, and create/invite users (server route using the service-role key).
- **Weekly Import** (management) — upload the weekly Excel (raw flat export or grouped
  per-facility report), parsed client-side with SheetJS. Upserts `claims` by `claim_id`,
  marks dropoffs `present=false`, seeds notes only for brand-new claims, excludes `VMAH*`
  member IDs.

## Deploy runbook

1. **Create a Supabase project** at supabase.com. Copy the Project URL and the `anon` public
   key (Project Settings → API).
2. **Load the database.** In Supabase open SQL → New query and run `supabase/schema.sql`, then
   `supabase/seed.sql`.
3. **Make yourself management.** Sign up once through the app, then in the SQL editor run:
   ```sql
   update profiles set role='management'
   where id = (select id from auth.users where email = 'YOUR_EMAIL');
   ```
4. **Set environment variables** (`.env.local` for local dev, Vercel project settings for prod):
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...   # server-only; used by Admin -> Create User
   ```
   The service-role key is read only in the server route `app/api/admin/create-user/route.ts`
   and is **never** exposed to the browser.
5. **Run locally:**
   ```bash
   npm install
   npm run dev
   ```
6. **Deploy to Vercel.** Import the repo, set the same env vars, deploy.

## Verifying the security boundary

After deploy, confirm:
- Sign in as **management** → sees all facilities.
- Sign in as **staff** → sees only assigned facilities.
- Sign in as **facility** → sees only their facility, read-only, and cannot load another
  facility's claims even by editing the URL/query (RLS blocks it).

## Stack notes

- `@supabase/ssr` provides the App Router auth/session helpers (`lib/supabase/*`).
- `middleware.ts` refreshes the session and redirects unauthenticated users to `/login`.
- The auth-issue routing/return flow is handled in the client + API layer; the database schema
  in `supabase/schema.sql` is the source of truth for the security model.
