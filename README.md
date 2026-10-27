# Fitness Hub — Karachi

Gym website with local styling, fitness calculators, online admissions, trial/class booking requests and a protected staff dashboard.

## Run locally

Requires Node.js 22.5 or newer.

```sh
npm install
npm start
```

Open http://localhost:3000. Staff access is in the footer, or at `/admin.html`.
For local demos only, the default login is `admin` / `fitnesshub@2026`.
Copy `.env.example` to `.env` and set your own `STAFF_PASSWORD` and `SESSION_SECRET` before deployment. Production staff sign-in requires both. The configured password is the only accepted password.

```sh
npm run build:css
npm test
```

Rebuild styling after editing utility classes in `public/index.html`. The generated `public/assets/site.css` is included for direct startup. Google Fonts and dashboard Chart.js currently load externally; main styles and gym photography are local.

## Data and behaviour

- SQLite is stored in `data/gym.db`; existing records are retained. Cloud Turso is optional using `DB_URL` / `DB_TOKEN`.
- Admissions create server-issued member references and stay pending until staff approve them.
- Trial/class requests persist in the database and appear in staff bookings. Availability is confirmed by phone; the website does not issue guaranteed class reservations.
- Fitness goals, preferred coach and selected add-on requests are retained and visible in pending admissions. Add-ons are estimates for reception confirmation, not automatic recurring charges.
- Staff can approve, reject, search, filter, edit and delete members, record renewal dates, print receipts and export CSV. Dashboard refreshes every 30 seconds while visible.
- Personal data is not cached in browser local storage. Protected actions only update the interface after the server succeeds.
- Tests use a separate temporary database and do not touch existing records.

## Before presenting or publishing

Verify the supplied business details, facility claims, trainer names/credentials, schedules and prices with the gym owner. Existing marketing details are retained as supplied. Calculators are general estimates.
Set unique production credentials, use HTTPS, back up the database, and use durable storage (or Turso for serverless hosting). Use `FRONTEND_ORIGIN` only when a separate frontend needs access. Login throttling is process-local; multi-instance deployments should add shared rate limiting.

## Owner desk (new)

Open `/admin.html`, sign in, then use the owner tabs:

- **Edit website:** membership prices, weekday/Sunday opening hours, coach details, website/trainer photos and an optional dated offer. Select a photo up to 15 MB; the editor resizes it to a compact JPEG before uploading (stored image under 1 MB). An HTTPS image URL also works. Photo preview and upload errors appear beside the file input. Changes persist in the database; conflicting editor saves are rejected instead of overwriting.
- **Cash payments:** record a received cash renewal, browse/search payment history, download CSV, and print or save a receipt as PDF. The dashboard supports cash only; online payments are intentionally excluded.
- **Overview & reports:** month-specific cash collection, receipt count, renewal count, current memberships, outstanding fees and monthly income chart.
- **Renewals:** overdue and due-within-five-days members, with individual WhatsApp reminder links. Staff review and send messages themselves; the site does not send automatic messages.

Approving an admission means its initial cash fee has been verified and records a receipt. Quick Add includes the first cash membership payment. Existing members retain their agreed price when website prices change; a plan change applies the current price to future renewals and preserves already-paid coverage. Member deletion does not remove cash receipts. Payments are immutable, snapshot-based audit records; retrospective payments from before this feature are not invented. Overdue totals are one membership-cycle fee per overdue member, not accrued arrears.

The ledger, CMS and image tables are created automatically alongside existing data. Vercel must continue using the configured Turso database; filesystem SQLite is for persistent local hosting only. No database files or staff credentials are committed. On production, missing `STAFF_PASSWORD` / `SESSION_SECRET` disables staff sign-in with an actionable message while the public website continues to work. `/api/health` reports `staffConfigured` without exposing values.
