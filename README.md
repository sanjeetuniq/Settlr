# SETTLR

A lightweight shared-expense app built with Next.js, TypeScript, and Supabase. It supports private groups (up to 40 members), two-decimal expense amounts, equal and custom splits, simplified settlement suggestions, recorded settlements, private PNG/PDF receipts, and in-app reminders.

Passwords and authentication sessions are managed by Supabase Auth. SETTLR does not store passwords in its application tables. Auth cookies are HTTP-only and same-site; group and expense access is enforced by Postgres Row Level Security (RLS). Receipt files are private and accessed through short-lived signed URLs.

Password reset links return through the Auth callback using Supabase's recovery flow. A successful reset updates the password through Supabase Auth, ends the local recovery session, and asks the user to sign in with the new password; passwords are never written directly to application tables.

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
4. Apply [`supabase/migrations/20261028182934_public_group_discovery_and_join.sql`](./supabase/migrations/20261028182934_public_group_discovery_and_join.sql) to enable public group discovery. Existing groups remain private by default. A group creator can open or close their group from the group panel. Open groups reveal only their name and currency in discovery; balances and expenses remain restricted to members. Joining requires a signed-in account and is transactionally limited to 40 members. This migration adds authenticated database functions and does not grant anonymous access.
5. Apply [`supabase/migrations/20261028184902_group_archive_and_lifecycle.sql`](./supabase/migrations/20261028184902_group_archive_and_lifecycle.sql) to enable settled-group archiving. Only the creator can archive, and the database verifies all balances are zero. Archived financial history is retained read-only, and archived groups are removed from discovery and cannot accept members or new activity.
   If the dashboard reports that `public.groups` is unavailable, apply these migrations and confirm the `public` schema is exposed through the Data API.

6. Apply [`supabase/migrations/20261029062342_invite_group_members.sql`](./supabase/migrations/20261029062342_invite_group_members.sql) to enable searching registered SETTLR accounts by display name or exact email and adding them directly to a group. Search is limited to the group creator, and the database enforces the 40-person limit. The group creator can also send a Supabase Auth invitation email to a new address; the recipient sets a password and joins from the invitation link. Configure custom SMTP in Supabase Auth for reliable email delivery and allow the app's `/auth/callback` redirect URL.

7. In Supabase Auth settings, set the site URL to `NEXT_PUBLIC_SITE_URL` and add these redirect URLs:
   - `http://localhost:3000/auth/callback`
   - Your deployed origin followed by `/auth/callback`

   Email confirmation and password reset messages use Supabase Auth. In the **Confirm signup** email template, link directly to the app callback with the token hash so verification also works when the email is opened in another browser:

   ```html
   <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email">
     Confirm your email
   </a>
   ```

   Keep the app's `/auth/callback` URL in the Supabase redirect allow list. If a link expires or has already been used, the sign-in page can send a fresh confirmation email.

8. Apply [`supabase/migrations/20261029065014_whatsapp_notifications_and_transaction_history.sql`](./supabase/migrations/20261029065014_whatsapp_notifications_and_transaction_history.sql) to enable private WhatsApp preferences, phone verification, an asynchronous notification outbox, search throttling, and combined expense/settlement history. The dashboard shows 20 recent transactions across your groups and loads older entries with a stable timestamp/ID cursor. If this migration is not applied, the existing recent-expense list remains available.

   WhatsApp delivery is optional and requires a Meta WhatsApp Cloud API business sender, a currently supported `WHATSAPP_GRAPH_API_VERSION`, server-only `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `SUPABASE_SERVICE_ROLE_KEY`. Add the approved Meta template names and language in `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_ACTIVITY_TEMPLATE_NAME`, and `WHATSAPP_TEMPLATE_LANGUAGE`. The authentication template must be an approved copy-code OTP template; the activity utility template must have a body URL placeholder for the app link. Never expose these secrets with a `NEXT_PUBLIC_` prefix.

   Users initiate phone verification from the dashboard. Verification codes expire after 10 minutes, are limited to five attempts, and are rate-limited to one send per minute and five sends per hour per account and phone number. Alerts are sent only to a currently verified, explicitly opted-in number and only for the selected activity types. Notifications intentionally omit names, balances, and amounts. Schedule authenticated `POST` requests to `/api/whatsapp/dispatch` with `Authorization: Bearer <WHATSAPP_WORKER_SECRET>` (for example, from a trusted cron service every minute); the worker claims at most 10 events per request and retries failed sends with backoff. Because Meta may accept a message before the database records its acknowledgement, delivery is at-least-once and a rare duplicate is possible. The endpoint must only be called by a trusted scheduler.

   UPI QR payments and payment-gateway integrations are not enabled. SETTLR does not mark a settlement paid from a QR scan or external payment callback; members must continue recording settlements in the app.

8. Start the app:

   ```sh
   npm run dev
   ```

   Open `http://localhost:3000`.

   Signed-out visits to the app root open the sign-in page. The marketing page remains available at `/welcome`; invite destinations are preserved through sign-in and email confirmation. Authentication pages use the supplied compact SETTLR logo. Signing out opens a friendship-themed page with a quote that changes between consecutive logouts and a direct sign-in link.

## Prisma

Prisma is configured for PostgreSQL with transaction-mode pooling for runtime connections and session-mode pooling for CLI operations. Replace `YOUR_PERCENT_ENCODED_PASSWORD` in `.env.local` before connecting. The current schema is intentionally empty until the Supabase database schema has been applied; use `npx prisma db pull` to introspect the existing database before using Prisma models. Do not run `prisma migrate dev` against the existing Supabase schema without first establishing a Prisma migration baseline.

## Product and data rules

- A group has one selected currency. Supported v1 currencies (INR, USD, EUR, GBP, CAD, AUD) use two decimal places. INR is the default; currency conversion is not included.
- Amounts and shares are stored as integer paise/minor units. Equal-split remainder is assigned deterministically by user ID; custom shares must add up exactly to the expense total.
- Quick expense entry defaults to the signed-in user as payer and an equal split among the group members shown in the form. Category defaults to Food and the date defaults to the current date; payer, split participants, custom amounts, category, date, and receipt remain editable under Change. The form continues to call the existing authenticated `create_expense` RPC with the same arguments, so this UI change does not require a database migration. The RPC independently checks that the payer and split participants are group members and that shares equal the total.
- After group creation, the app offers a first-expense step with amount entry followed by current-member split checkboxes. Only members who have joined at that time are included; later members do not change previously recorded shares. The first expense may be deferred.
- Settlement suggestions use deterministic greedy matching to reduce transfers; they are suggestions, not a guarantee of the globally minimum number of payments. A suggestion changes balances only after a member records it, and recorded amounts cannot exceed the current pairwise debt/credit.
- Invite links are creator-issued, revocable, valid for seven days, and may be shared manually. Only a token hash is stored. Joining requires an authenticated account and is capped transactionally at 40 members.
- Group creators can search registered accounts by display name or exact email and add them directly; this reveals matching account names and email addresses to the group creator. Email invitations to new users use Supabase Auth email delivery, require the server-only `SUPABASE_SERVICE_ROLE_KEY`, and send a password-setup link that preserves the group invitation.
- Groups are private by default. Their creator can mark a group open for discovery by signed-in users; discovery returns only the group name and currency. Joining remains authenticated and is capped at 40 members by a database function and trigger. Open visibility does not expose expenses or balances to non-members.
- A group creator can archive a group only when every member balance is zero. Archiving preserves expenses, settlements, and receipts, hides the group from active navigation, and exposes the retained history read-only in the Archive section. Database functions and insert guards prevent new joins and financial activity after archiving.
- Receipt uploads accept only actual PNG or PDF signatures, are limited to 5 MB, and are stored in a private bucket. Email/SMS reminders are not sent; reminders appear only inside the app.
- WhatsApp alerts require independent number verification and explicit opt-in; users can disable them and choose event categories at any time. The message worker uses a protected outbox and sends only generic activity notices plus the app URL.
- The dashboard and login screen display a processing state during submissions and route transitions. Support is available at [helpdesk_settlr@gmail.com](mailto:helpdesk_settlr@gmail.com).
- The dashboard uses an original, colorful CSS design with system fonts rather than a charting/UI framework or external font request.

## Validation

```sh
npm run lint
npm run build
npm test
```

`npm test` uses Node.js built-in type stripping, so use Node.js 22.6 or newer.
