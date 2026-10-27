# Pre-Booking

Booking and lease management for hosts with daily and yearly rentals. Staff sign in with Google, manage several properties, and the app installs on phones as a PWA.

- **Stack:** Next.js 15 (App Router, TypeScript) on Cloudflare Workers via OpenNext · Supabase (Postgres, Auth, Storage)
- **Design docs:** `docs/01-functional-design.md`, `docs/02-screen-design.md`, `docs/03-pwa.md`
- **UI mockups:** `docs/ui/index.html`, `docs/brand/index.html`

## What's in Sprint 1

| Area | Done |
|---|---|
| Sign in | Google only. Only emails on the team can create an account (Supabase "Before User Created" hook); deactivated members are blocked on every page and by row-level security |
| Team | Admins add Google emails with a role (Admin, Manager, Front desk, Accountant) and properties; change roles; deactivate. The team always keeps one active admin |
| Business settings | Name, address, tax ID, phone, reservation pay-by window, front desk discount limit |
| Overview | All properties as cards (photo, units, daily/yearly split); tap one to focus on it |
| Property setup | 6 steps: details + photo → room types → units (add a range like 301–320) → daily and yearly rates → water/electricity prices and starting meter readings → staff, then **Open for bookings** |
| PWA | Manifest, icons from logo B, service worker (Serwist), offline page and bar, "Install app" in the profile menu (iPhone shows Add to Home Screen steps), cache cleared on sign-out |

## What's in Sprint 2

| Area | Done |
|---|---|
| Booking rules (in Postgres) | One transaction per action. No double booking (exclusion constraint on unit + dates; back-to-back stays allowed). Prices and payment schedules come from rate plans. Front desk discounts are capped by the business setting and need a reason |
| Daily bookings | Reserve first, pay in full before check-in. The reservation holds the unit until the pay-by time (check-in time on arrival day by default), then is released automatically. Fri and Sat nights use the weekend rate. Check-in is blocked while money is due (a manager can override with a reason) |
| Yearly leases | Deposit + rent in advance due on move-in, then one rent period per month counted from the move-in date (31 Jan → 28 Feb → 31 Mar). The lease confirms once the move-in amount is paid |
| Payments | Amount, date received, method, reference; withholding tax for company tenants. Applied to the oldest period first (or chosen periods). Overpayment is kept as credit. Managers and accountants can void with a reason. Every period shows its status (Upcoming, Due, Part paid, Overdue, Paid) and the date it was paid |
| Screens | Today per property · Calendar (tap an empty day to book; block dates for maintenance) · Bookings (Upcoming, Reserved, In house, Past, Cancelled) · New booking wizard (type → dates & unit → guest → review) · Booking detail (record payment, check in/out, no-show, cancel with refund from the cancellation policy) · Payments (outstanding by age, payments received) · Overview with live numbers across all properties |

Meters and documents (invoice, receipt) come next. They show as "Soon" in the sidebar.

## Setup

### 1. Supabase

1. Create a project (region **Singapore**).
2. Enable the **pg_cron** extension (Database → Extensions), then run the migrations in `supabase/migrations/` in order. Paste them into the SQL editor, or use `supabase db push`. `..._sprint2_cron.sql` releases unpaid reservations every 5 minutes.
3. Add yourself as the first admin: edit and run `supabase/seed.example.sql`.
4. **Authentication → Providers → Google:** turn it on and paste the Client ID and secret from step 2 below. Turn **off** Email sign-up.
5. **Authentication → Hooks → Before User Created:** choose Postgres function `public.hook_before_user_created`.
6. **Authentication → URL Configuration:** set Site URL to your domain and add `https://YOUR-DOMAIN/auth/callback` (and `http://localhost:3000/auth/callback` for development) to Redirect URLs.

### 2. Google Cloud (OAuth client)

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External, app name "Pre-Booking", scopes `email`, `profile`, `openid`. Publish it (in "Testing" only listed test users can sign in).
2. **Credentials → Create OAuth client ID → Web application.**
   Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
3. Copy the Client ID and secret into Supabase (step 1.4).

### 3. Run locally

```bash
cp .env.example .env.local   # fill in the Supabase URL and anon (publishable) key
npm install
npm run dev                  # http://localhost:3000
```

The service worker only runs in production builds. To test it, use `npm run build && npm start`.

### 4. Deploy to Cloudflare

1. Put the Supabase URL and anon key in `wrangler.jsonc` → `vars`, and in the environment of whatever runs the build. `NEXT_PUBLIC_*` values are baked in at build time.
2. `npx wrangler login`
3. `npm run deploy` builds with OpenNext and deploys the Worker.
4. Add your domain in Cloudflare, then add it to the Supabase redirect URLs.

The current bundle is about 1.3 MB gzipped. That is within the Workers free-plan size limit, but for real traffic use **Workers Paid**, because the free plan's CPU time per request is tight for server-rendered pages.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Next.js production build |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (money, unit ranges, setup checklist, redirects, validation, dates, refunds) |
| `npm run icons` | Regenerate PWA icons in `public/icons` from the logo |
| `npm run preview` | Build for Cloudflare and run it locally with Wrangler |
| `npm run deploy` | Build and deploy to Cloudflare |

## Notes for developers

- Money is stored in satang (`bigint`). Use `bahtToSatang` / `formatTHB` from `src/lib/money.ts`.
- Booking and payment writes go only through Postgres functions (`create_booking`, `record_payment`, `check_in`, …) in `supabase/migrations/..._sprint2_bookings.sql`; the tables are read-only to the app. Errors raised there are written for staff to read and are shown as-is.
- Other data access goes through Supabase with the signed-in user's session, so row-level security decides what each person sees. Admins see every property; others only the ones they are assigned to. Booking and payment logic in Sprint 2 will add transactional SQL functions; the Drizzle + Hyperdrive setup in the design doc can come in then if needed.
- Property photos live in the private `property-photos` bucket and are shown through signed URLs.
