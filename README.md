# Superhero CPR

Full-stack platform for [superherocpr.com](https://superherocpr.com) — a Tampa-based AHA-certified CPR training business. Replaces the current WordPress site with a custom booking, certification, invoicing, and staff management system.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14+ (App Router) |
| Database + Auth | Supabase (Postgres) |
| Hosting | AWS Amplify |
| Payments (public) | PayPal |
| Payments (invoices) | PayPal / Square / Stripe / Venmo Business |
| Email (transactional) | Resend |
| Email (contact replies) | Zoho Mail |
| File Storage | AWS S3 |
| SMS | Twilio |
| Mobile (future) | React Native (Expo) |

---

## Environments

| Environment | Branch | URL |
|---|---|---|
| Development | local | `http://localhost:3000` |
| Staging | `staging` | `https://staging.superherocpr.com` |
| Production | `main` | `https://superherocpr.com` |

Each environment has its own Supabase project and S3 bucket. Environment variables are managed in the AWS Amplify console per branch. See `.env.example` for the full variable list.

---

## Project Structure

```
/
├── apps/
│   ├── web/          # Next.js application
│   └── mobile/       # React Native / Expo (future)
├── packages/
│   ├── database/     # Supabase type generation
│   └── config/       # Shared Tailwind, ESLint, TS configs
├── PageGuides/       # Per-page build guides for AI-assisted development
│   └── admin/
├── schema.md         # Database schema (all tables and columns)
├── schema-notes.md   # Workflows, relationships, system notes
├── DESIGN-SYSTEM.md  # Visual language, tokens, component patterns
├── FOLDER-STRUCTURE.md # Canonical file and folder layout
└── .env.example      # Environment variable documentation
```

---

## Getting Started

**1. Clone and install**
```bash
git clone https://github.com/Superherocpr/Monorepo.git
cd Monorepo/apps/web
npm install
```

**2. Set up environment variables**
```bash
cp ../../.env.example .env.local
# Fill in .env.local with your development credentials
```

**3. Set up Supabase**
- Create a Supabase project for development
- Run migrations from `apps/web/supabase/migrations/` in order
- Run `apps/web/supabase/seed.sql` to populate initial data

**4. Run the development server**
```bash
npm run dev
```

---

## Documentation

All planning documentation is in the monorepo root. Read these before touching the code.

- **`schema.md`** — Every table, column, type, and constraint
- **`schema-notes.md`** — Workflows, email triggers, sidebar nav, API endpoints
- **`FOLDER-STRUCTURE.md`** — Where every file lives
- **`DESIGN-SYSTEM.md`** — Tailwind tokens, component patterns, dark mode
- **`PageGuides/`** — Self-contained build guide for every page in the application

---

## Key Concepts

**Two sides, one codebase.** The public site and customer portal live under `app/(public)/`. The staff admin panel lives under `app/(admin)/`. They share the same Supabase backend but have distinct visual identities and auth guards.

**All sessions require approval.** Class sessions created by any role — instructor, manager, or super admin — go through an approval workflow before appearing publicly.

**Instructor payments are personal.** Instructors connect their own PayPal, Square, Stripe, or Venmo Business account. Invoice payments go directly to the instructor, not the business.

**Three public tools run unauthenticated.** `/rollcall` (student check-in), `/roster/[session_token]` (roster correction), and `/submit-roster` (company roster upload) are intentionally public — they run on student phones in a classroom setting.

---

## Contributing

See `Page Guides` for the build order, coding standards, and known failure modes.
All code changes should be developed locally, tested on staging, then merged to main.
