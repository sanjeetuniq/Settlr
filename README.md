# SETTLR

A lightweight shared-expense app built with Next.js, TypeScript, and Supabase. It supports private groups (up to 40 members), two-decimal expense amounts, equal and custom splits, simplified settlement suggestions, recorded settlements, private PNG/PDF receipts, and in-app reminders.

Passwords and authentication sessions are managed by Supabase Auth. SETTLR does not store passwords in its application tables. Auth cookies are HTTP-only and same-site; group and expense access is enforced by Postgres Row Level Security (RLS). Receipt files are private and accessed through short-lived signed URLs.

## Requirements

- Node.js 20.9 or newer (Node.js 22+ recommended)
- A Supabase project

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set:
   - `NEXT_PUBLIC_SUPABASE_URL` to the project URL.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the Supabase publishable key (or `NEXT_PUBLIC_SUPABASE_ANON_KEY` if using a legacy anon key).
   - `NEXT_PUBLIC_SITE_URL` to the app origin (`http://localhost:3000` locally).
   - `DATABASE_URL` to the transaction-mode pooler connection for Prisma runtime and `DIRECT_URL` to the session-mode pooler for Prisma CLI operations. Replace the password placeholders locally, percent-encoding special characters; do not commit real connection strings.
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_JWKS_URL` for server-side handlers using `@supabase/server`.
   - `SUPABASE_SECRET_KEY` to a server-only Supabase secret key. Never expose it to browser code or commit it.
   - `SUPABASE_SERVICE_ROLE_KEY` to the server-only service role key. Receipt uploads are signature-checked on the server before this key is used. It must never be exposed to browser code or committed.

3. Apply [`supabase/migrations/20261028000000_initial_schema.sql`](./supabase/migrations/20261028000000_initial_schema.sql) in the Supabase SQL Editor (or with the Supabase CLI). It creates the tables, auth profile trigger, RLS policies, transactional RPCs, and private receipt bucket, including the authenticated `create_group` RPC. If the schema was already applied, apply the `create_group` function and its revoke/grant statements from the migration before using group creation.
   If the dashboard reports that `public.groups` is unavailable, apply this migration and confirm the `public` schema is exposed through the Data API.

4. In Supabase Auth settings, set the site URL to `NEXT_PUBLIC_SITE_URL` and add these redirect URLs:
   - `http://localhost:3000/auth/callback`
   - Your deployed origin followed by `/auth/callback`

   Email confirmation and password reset messages use Supabase Auth. If email confirmation is enabled, configure the Supabase confirmation email template to link to the app's `/auth/callback` route.

5. Start the app:

   ```sh
   npm run dev
   ```

   Open `http://localhost:3000`.

## Prisma

Prisma is configured for PostgreSQL with transaction-mode pooling for runtime connections and session-mode pooling for CLI operations. Replace `YOUR_PERCENT_ENCODED_PASSWORD` in `.env.local` before connecting. The current schema is intentionally empty until the Supabase database schema has been applied; use `npx prisma db pull` to introspect the existing database before using Prisma models. Do not run `prisma migrate dev` against the existing Supabase schema without first establishing a Prisma migration baseline.

## Product and data rules

- A group has one selected currency. Supported v1 currencies (INR, USD, EUR, GBP, CAD, AUD) use two decimal places. INR is the default; currency conversion is not included.
- Amounts and shares are stored as integer paise/minor units. Equal-split remainder is assigned deterministically by user ID; custom shares must add up exactly to the expense total.
- Settlement suggestions use deterministic greedy matching to reduce transfers; they are suggestions, not a guarantee of the globally minimum number of payments. A suggestion changes balances only after a member records it, and recorded amounts cannot exceed the current pairwise debt/credit.
- Invite links are creator-issued, revocable, valid for seven days, and may be shared manually. Only a token hash is stored. Joining requires an authenticated account and is capped transactionally at 40 members.
- Receipt uploads accept only actual PNG or PDF signatures, are limited to 5 MB, and are stored in a private bucket. Email/SMS reminders are not sent; reminders appear only inside the app.
- The dashboard uses system fonts and CSS rather than a charting/UI framework or external font request.

## Validation

```sh
npm run lint
npm run build
npm test
```

`npm test` uses Node.js built-in type stripping, so use Node.js 22.6 or newer.
