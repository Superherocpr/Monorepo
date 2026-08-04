# Superhero CPR — Monorepo Folder Structure

This document defines the canonical file and folder layout for the entire project.
All page guides reference paths defined here. When in doubt, this file is authoritative.

---

## Root Structure

```
/
├── apps/
│   ├── web/                        # Next.js (App Router) — main website + admin
│   └── mobile/                     # React Native (Expo) — future mobile app
├── packages/
│   ├── database/                   # Shared Supabase type generation config
│   └── config/                     # Shared Tailwind, ESLint, TS configs
├── .github/
│   └── copilot-instructions.md     # Standing rules injected into every Copilot request
├── PageGuides/                     # Per-page AI build guides
│   └── admin/
├── schema.md                       # Database table definitions
├── schema-notes.md                 # Relationships, workflows, system notes
├── AI-DEV-BRIEF.md                 # Developer onboarding brief for AI builders
├── DESIGN-SYSTEM.md                # Visual language, tokens, component patterns
├── FOLDER-STRUCTURE.md             # This file
├── .env.example                    # Environment variable documentation (committed)
├── .env.local                      # Local development env vars (gitignored)
└── .env.staging                    # Staging env var reference (gitignored — see below)
```

**`.env.local`** — Local development values. Never committed. Copy from `.env.example`.

**`.env.staging`** — A local reference copy of the staging environment variables.
Never committed. Useful for verifying staging config locally before pushing.
The authoritative staging env vars live in the AWS Amplify console under the
`staging` branch environment variable settings — not in this file.

---

## Git Branches → Environments

| Branch | Environment | Deployed URL | Amplify Auto-Deploy |
|---|---|---|---|
| `main` | Production | `https://superherocpr.com` | Yes |
| `staging` | Staging | `https://staging.superherocpr.com` | Yes |
| `dev/*`, `feature/*` | Local only | `http://localhost:3000` | No |

Each branch has its own environment variable set configured in the Amplify console.
All three environments run identical application code — only env vars differ.

---

## Web Application (`apps/web`)

### Top-Level Layout

```
apps/web/
├── app/                            # Next.js App Router root (no src/ prefix)
├── components/                     # Truly shared UI primitives only
│   └── ui/                         # Button, Badge, Input, Modal, etc.
├── lib/                            # Utilities and shared logic
├── types/                          # TypeScript interfaces
├── content/                        # Markdown files (bios)
├── public/                         # Static assets
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

(Database migrations live at `Building/migrations/`, not inside `apps/web/`.)

---

### App Router — Route Groups & Pages

```
app/
├── layout.tsx                      # Root layout (fonts, metadata)
│
├── (public)/                       # Public site + customer portal
│   ├── layout.tsx                  # Public header + footer
│   │
│   ├── page.tsx                    # / — Home
│   ├── _components/home/           # HeroSection, ClassTypesSection, etc.
│   │
│   ├── about/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── classes/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── schedule/
│   │   ├── page.tsx
│   │   └── _components/            # ScheduleHeroSection, ScheduleClient, etc.
│   │
│   ├── merch/
│   │   ├── page.tsx
│   │   └── _components/            # MerchHeroSection, MerchClient, etc.
│   │
│   ├── contact/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── book/                       # 5-step booking flow
│   │   ├── page.tsx                # Step 1 — Select session
│   │   ├── signin/
│   │   │   └── page.tsx            # Step 2a — Sign in
│   │   ├── details/
│   │   │   └── page.tsx            # Step 2b — Customer details
│   │   ├── create-account/
│   │   │   └── page.tsx            # Step 3 — Create account
│   │   ├── payment/
│   │   │   └── page.tsx            # Step 4 — PayPal checkout
│   │   ├── confirmation/
│   │   │   └── page.tsx            # Step 5 — Booking confirmed
│   │   └── _components/            # BookingProgress, OrderSummary
│   │
│   ├── rollcall/
│   │   ├── page.tsx                # Walk-in student registration
│   │   └── _components/
│   │
│   ├── roster/
│   │   └── [session_token]/
│   │       ├── page.tsx            # Student roster correction
│   │       └── _components/
│   │
│   ├── submit-roster/
│   │   ├── page.tsx                # Company roster upload
│   │   └── _components/
│   │
│   └── dashboard/                  # Customer portal
│       ├── layout.tsx              # Auth guard (checks archived), DashboardNav
│       ├── page.tsx                # /dashboard — Overview widgets
│       ├── _components/            # DashboardNav, widgets
│       ├── bookings/
│       │   ├── page.tsx
│       │   └── _components/
│       ├── certifications/
│       │   ├── page.tsx
│       │   └── _components/
│       ├── orders/
│       │   ├── page.tsx
│       │   └── _components/
│       └── settings/
│           ├── page.tsx
│           └── _components/
│
├── (admin)/                        # Staff admin panel
│   ├── layout.tsx                  # Auth guard, role check, AdminSidebar
│   │
│   ├── page.tsx                    # /admin — Admin dashboard
│   ├── _components/                # AdminSidebar, shared admin components
│   │
│   ├── sessions/
│   │   ├── page.tsx                # Session list
│   │   ├── new/
│   │   │   └── page.tsx            # Create session
│   │   ├── approvals/
│   │   │   └── page.tsx            # Approval queue
│   │   ├── [id]/
│   │   │   ├── page.tsx            # Session detail
│   │   │   ├── grades/
│   │   │   │   └── page.tsx        # Grading tool
│   │   │   └── roster/
│   │   │       └── page.tsx        # Roster import
│   │   └── _components/
│   │
│   ├── invoices/
│   │   ├── page.tsx                # Invoice list
│   │   ├── new/
│   │   │   └── page.tsx            # Create invoice (3-step wizard)
│   │   ├── [id]/
│   │   │   └── page.tsx            # Invoice detail
│   │   └── _components/
│   │
│   ├── customers/
│   │   ├── page.tsx                # Customer list
│   │   ├── [id]/
│   │   │   └── page.tsx            # Customer detail (tabbed)
│   │   └── _components/
│   │
│   ├── payments/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── contact/
│   │   ├── page.tsx                # Contact submissions + Zoho reply thread
│   │   └── _components/
│   │
│   ├── locations/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── certifications/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── merch/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── orders/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── staff/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── settings/
│   │   ├── page.tsx                # Class types, preset grades, Zoho, dark mode
│   │   └── _components/
│   │
│   ├── archived/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   ├── analytics/
│   │   ├── page.tsx
│   │   └── _components/
│   │
│   └── profile/
│       └── payment/
│           ├── page.tsx            # Instructor payment account connect
│           └── _components/
│
└── api/                            # API Routes
    │
    ├── account/
    │   └── archive/
    │       └── route.ts            # POST — Customer archives own account
    │   # NOTE: profile updates and password changes are handled client-side
    │   # via supabase.auth.updateUser() — no API route required.
    │
    ├── analytics/
    │   └── route.ts                # GET — Aggregated analytics for /admin/analytics
    │
    ├── bookings/
    │   └── confirm/
    │       └── route.ts            # POST — PayPal confirm, create booking + payment
    │
    ├── cert-types/
    │   ├── route.ts                # POST — Create cert type
    │   └── [id]/
    │       └── route.ts            # PATCH / DELETE — Update or delete cert type
    │
    ├── certifications/
    │   ├── route.ts                # POST — Manually issue certification
    │   ├── [id]/
    │   │   └── route.ts            # PATCH / DELETE — Update or revoke certification
    │   ├── send-reminders/
    │   │   └── route.ts            # POST — Bulk send or individual cert reminder
    │   └── reminders-pause/
    │       └── route.ts            # POST — Pause/resume cert reminder system
    │
    ├── contact/
    │   ├── route.ts                # POST — Submit contact form
    │   ├── reply/
    │   │   └── route.ts            # POST — Send Zoho reply to submission
    │   ├── thread/
    │   │   └── route.ts            # GET — Fetch Zoho thread messages
    │   ├── zoho-auth/
    │   │   └── route.ts            # GET — Initiate Zoho OAuth flow
    │   └── zoho-callback/
    │       └── route.ts            # GET — Handle Zoho OAuth callback, store tokens
    │
    ├── customers/
    │   ├── search/
    │   │   └── route.ts            # GET — Server-side customer search
    │   ├── create/
    │   │   └── route.ts            # POST — Create customer account + setup email
    │   ├── restore/
    │   │   └── route.ts            # POST — Restore archived customer
    │   └── [id]/
    │       ├── update-profile/
    │       │   └── route.ts        # PATCH — Update profile fields
    │       ├── send-password-reset/
    │       │   └── route.ts        # POST — Generate + send password reset link
    │       ├── archive/
    │       │   └── route.ts        # POST — Archive customer account
    │       ├── add-booking/
    │       │   └── route.ts        # POST — Manually add booking (staff)
    │       ├── cancel-booking/
    │       │   └── route.ts        # POST — Cancel booking with reason
    │       ├── bookings-for-payment/
    │       │   └── route.ts        # GET — Customer's bookings eligible for payment logging
    │       ├── issue-cert/
    │       │   └── route.ts        # POST — Manually issue certification
    │       ├── log-payment/
    │       │   └── route.ts        # POST — Log cash/check/deposit payment
    │       ├── update-tracking/
    │       │   └── route.ts        # PATCH — Update order tracking number
    │       └── update-notes/
    │           └── route.ts        # PATCH — Update internal staff notes
    │
    ├── emails/
    │   └── welcome/
    │       └── route.ts            # POST — Send welcome email via Resend
    │
    ├── invoices/
    │   ├── create/
    │   │   └── route.ts            # POST — Create invoice on platform + DB
    │   ├── mark-paid/
    │   │   └── route.ts            # POST — Manually mark invoice paid
    │   ├── resend/
    │   │   └── route.ts            # POST — Resend invoice email
    │   └── cancel/
    │       └── route.ts            # POST — Cancel invoice on platform + DB
    │
    ├── locations/
    │   ├── route.ts                # POST — Create location
    │   └── [id]/
    │       ├── route.ts            # PATCH / DELETE — Update or delete location
    │       └── set-home-base/
    │           └── route.ts        # POST — Mark a location as the home base
    │
    ├── merch/
    │   ├── route.ts                # POST — Create product
    │   ├── upload-image/
    │   │   └── route.ts            # POST — Upload product image to S3
    │   └── [id]/
    │       ├── route.ts            # PATCH / DELETE — Update or delete product
    │       └── adjust-stock/
    │           └── route.ts        # PATCH — Adjust stock (logs to stock_adjustments)
    │
    ├── orders/
    │   ├── confirm/
    │   │   └── route.ts            # POST — PayPal confirm, create order + items
    │   ├── mark-shipped/
    │   │   └── route.ts            # PATCH — Add tracking number, send ship email
    │   ├── mark-delivered/
    │   │   └── route.ts            # PATCH — Mark order delivered
    │   ├── cancel-refund/
    │   │   └── route.ts            # POST — Cancel order, refund PayPal, restore stock
    │   └── update-notes/
    │       └── route.ts            # PATCH — Update internal order notes
    │
    ├── payments/
    │   ├── log/
    │   │   └── route.ts            # POST — Log a manual payment record
    │   ├── set-active/
    │   │   └── route.ts            # PATCH — Set instructor's active payment account
    │   ├── [id]/
    │   │   └── disconnect/
    │   │       └── route.ts        # DELETE — Remove instructor payment account
    │   └── oauth/
    │       ├── paypal/
    │       │   ├── route.ts        # GET — Initiate PayPal instructor OAuth
    │       │   └── callback/
    │       │       └── route.ts    # GET — Handle callback, store tokens
    │       ├── square/
    │       │   ├── route.ts        # GET — Initiate Square OAuth
    │       │   └── callback/
    │       │       └── route.ts
    │       ├── stripe/
    │       │   ├── route.ts        # GET — Initiate Stripe Connect OAuth
    │       │   └── callback/
    │       │       └── route.ts
    │       └── venmo/
    │           ├── route.ts        # GET — Initiate Venmo Business OAuth
    │           └── callback/
    │               └── route.ts
    │
    ├── paypal/
    │   ├── create-order/
    │   │   └── route.ts            # POST — Create PayPal order for merch checkout
    │   └── create-booking-order/
    │       └── route.ts            # POST — Create PayPal order for booking checkout
    │                               #        (applies instructor payment routing)
    │
    ├── rollcall/
    │   ├── verify-code/
    │   │   └── route.ts            # POST — Validate instructor daily code
    │   ├── check-email/
    │   │   └── route.ts            # POST — Check if student has an account
    │   ├── checkin/
    │   │   └── route.ts            # POST — Sign in + create roster_record
    │   ├── register/
    │   │   └── route.ts            # POST — New account + create roster_record
    │   ├── refresh-my-code/
    │   │   └── route.ts            # POST — Instructor manually refreshes own daily code
    │   # NOTE: Daily code regeneration runs in Postgres via pg_cron — no HTTP route.
    │   #       See Building/migrations/0006_daily_access_code_cron.sql
    │
    ├── roster/
    │   ├── confirm/
    │   │   └── route.ts            # PATCH — Student confirms/corrects info
    │   └── import/
    │       └── route.ts            # POST — Admin imports a parsed roster CSV
    │
    ├── roster-upload/
    │   ├── lookup/
    │   │   └── route.ts            # POST — Look up invoice by number
    │   └── submit/
    │       └── route.ts            # POST — Upload roster file to S3
    │
    ├── payouts/
    │   ├── create/
    │   │   └── route.ts            # POST — Reserve earnings and send PayPal payout batch
    │   ├── release/
    │   │   └── route.ts            # POST — Release failed unsubmitted payout batch after review
    │   └── sync/
    │       └── route.ts            # POST — Sync PayPal payout status
    │
    ├── profile/
    │   └── payout-email/
    │       └── route.ts            # PATCH — Save instructor PayPal payout email
    │
    ├── settings/
    │   ├── class-types/
    │   │   ├── route.ts            # POST — Create class type
    │   │   └── [id]/
    │   │       ├── route.ts        # PATCH — Update class type
    │   │       └── toggle-active/
    │   │           └── route.ts    # PATCH — Activate/deactivate class type
    │   ├── preset-grades/
    │   │   ├── route.ts            # POST — Create preset grade
    │   │   └── [id]/
    │   │       └── route.ts        # PATCH / DELETE — Update or delete preset grade
    │   └── zoho/
    │       └── disconnect/
    │           └── route.ts        # DELETE — Clear Zoho tokens from system_settings
    │
    └── staff/
        ├── invite/
        │   └── route.ts            # POST — Create staff account + invite email
        └── [id]/
            ├── role/
            │   └── route.ts        # PATCH — Change staff role
            ├── deactivate/
            │   └── route.ts        # POST — Deactivate staff + ban Supabase auth
            └── reactivate/
                └── route.ts        # POST — Reactivate staff + unban Supabase auth

# NOTE: Session approve / reject / edit are implemented as Next.js Server Actions
# in app/(admin)/admin/sessions/[id]/actions.ts. Session cancel/claim and other
# session mutations that send email live under /api/sessions/:
#
#   api/sessions/
#   ├── route.ts                              # POST — Create session
#   ├── bulk/route.ts                         # POST — Bulk-create sessions
#   ├── notify-unclaimed-opportunities/
#   │   └── route.ts                          # POST — Cron (CRON_SECRET): escalate unclaimed
#   │                                         #        cancelled sessions to super admins
#   └── [id]/
#       ├── status/route.ts                   # PATCH — scheduled → in_progress → completed
#       ├── accept-teach/route.ts             # POST — Claim customer-requested session (FCFS)
#       ├── cancel/route.ts                   # POST — Cancel session → open opportunity
#       └── claim/route.ts                    # POST — Claim cancelled session (FCFS, atomic)
#
#   api/class-requests/
#   ├── route.ts                              # GET/POST — Customer class requests
#   └── [id]/
#       ├── approve/route.ts                  # POST — Approve → create session + broadcast
#       └── reject/route.ts                   # POST — Reject with reason
#
# NOTE: The /api/enrollware/ browser-extension endpoints are deferred and not yet built.
```

---

### Shared Libraries (`apps/web/lib`)

```
lib/
├── supabase/
│   ├── client.ts                   # Browser Supabase client (for client components)
│   └── server.ts                   # Server Supabase client (for server components + API routes)
├── booking-store.ts                # sessionStorage booking flow state (typed, no Zustand)
├── cart-store.ts                   # localStorage cart state (typed, no Zustand)
├── bios.ts                         # Markdown parser for instructor bio files
├── cert-utils.ts                   # Certification expiry / status helpers
├── constants.ts                    # OWNER_EMAIL and other hardcoded values
├── instructor-earnings.ts          # Calculates and records instructor payout earnings
├── paypal.ts                       # PayPal business REST helpers
├── paypal-payouts.ts               # PayPal Payouts API helpers
└── zoho.ts                         # Zoho Mail API helpers (send, fetch thread, token refresh)
```

---

### TypeScript Interfaces (`apps/web/types`)

```
types/
├── bookings.ts                     # BookingRecord (all 4 booking_source values)
├── certifications.ts               # CertificationRecord
├── contact.ts                      # ContactSubmission, ContactThreadMessage
├── invoices.ts                     # InvoiceRecord, InvoiceLineItem
├── merch.ts                        # Product, ProductVariant, CartItem
├── orders.ts                       # OrderRecord, OrderItem
├── roster.ts                       # RosterRecord, RosterUpload
├── schedule.ts                     # ScheduleSession, ClassTypeOption
├── social.ts                       # SocialFeedItem (Facebook cache)
└── users.ts                        # ProfileRecord, StaffRecord
```

> Note: Supabase auto-generated types (from `supabase gen types`) live in
> `packages/database/` and are imported where needed. Do not duplicate them in `types/`.

---

### Content — Markdown Files (`apps/web/content`)

```
content/
└── bios/
    ├── lead-instructor.md          # Lead instructor bio (keyed to is_lead_instructor = true)
    └── instructors/
        └── [bio_slug].md           # Per-instructor bio (keyed to profiles.bio_slug)
```

---

### Static Assets (`apps/web/public`)

```
public/
├── images/
│   ├── logo/                       # SVG and PNG logo variants
│   ├── aha/                        # AHA badge/logo assets
│   └── placeholders/               # Dev placeholder images
└── fonts/                          # Self-hosted fonts if any (otherwise CDN)
```

---

### Supabase Migrations (`Building/migrations`)

```
Building/migrations/
├── 0001_initial_schema.sql
├── 0002_decrement_stock_rpc.sql
├── 0003_increment_stock_rpc.sql
├── 0004_payment_routing.sql              # historical: old profiles.payment_routing column
├── 0005_payment_routing_note.sql         # payments.routing_note audit column
├── 0006_daily_access_code_cron.sql       # pg_cron job: regenerate codes nightly
├── 0020_instructor_payouts.sql           # retires old routing and adds PayPal Payouts tables
├── 0025_customer_class_requests.sql      # class_requests table; nullable instructor_id
├── 0026_open_opportunities.sql           # cancel/claim columns + escalation cron job
├── 0027_class_requests_rls.sql           # RLS on class_requests (THREAT-045)
├── 0028_discount_percent_catchup.sql     # discount_percent (was hand-applied to staging only)
├── 0029_unclaimed_escalation_schedule.sql # escalation cron: 6x daily Eastern (was every 30 min)
└── ...
```

Migrations are kept in `Building/migrations/` (not under `apps/web/`) because they
are run manually via the Supabase SQL editor, not by the application at runtime.

Migrations must be applied to ALL three Supabase projects (development, staging,
production) when schema changes are made. Never apply a migration to production
without first verifying it on staging.

---

## Mobile Application (`apps/mobile`)

Placeholder structure — not in active development.

```
apps/mobile/
├── app/                            # Expo Router
├── components/
├── lib/
│   └── supabase.ts
├── types/
├── assets/
├── app.json
└── package.json
```

---

## Key Conventions

**Component colocation:** Each route's components live in a `_components/` folder within that route. The underscore prefix keeps them out of Next.js routing. Only truly shared, stateless UI primitives (Button, Badge, Input, Modal) live in the root `components/ui/`.

**No `src/` prefix:** All paths start from `app/`, `lib/`, `types/` etc. at the `apps/web/` root. The page guides are written this way — do not add a `src/` layer.

**No Zustand:** The booking flow uses a typed `sessionStorage` utility (`lib/booking-store.ts`). The cart uses a typed `localStorage` utility (`lib/cart-store.ts`). Both are lightweight custom utilities documented in the page guides. Do not introduce Zustand.

**No separate `(auth)` route group:** Sign-in during booking lives at `/book/signin` under `(public)`. There is no standalone auth route group.

**No hardcoded URLs:** Use `process.env.NEXT_PUBLIC_BASE_URL` wherever the app references its own domain. This is what allows staging and production to behave identically with different env vars.

**Path aliases:** `@/` maps to `apps/web/` root. Example: `import { createClient } from '@/lib/supabase/server'`

**Migrations across environments:** Every Supabase migration must be applied to all three projects. Development → Staging → Production. Never skip staging.
