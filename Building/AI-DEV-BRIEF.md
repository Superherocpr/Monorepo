# Superhero CPR — AI Developer Brief
**For:** Claude Sonnet 4.6
**Project:** Superhero CPR — superherocpr.com
**Stack:** Next.js (App Router) · Supabase · Tailwind CSS · TypeScript (strict)
**Monorepo root:** `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/`
**Planning docs root:** `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/Building/`
**Web app root:** `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/apps/web/`

---

## What This Project Is

A full-stack platform replacing the current WordPress site at superherocpr.com.
Tampa-based AHA-certified CPR training business. The platform has two distinct sides:

- **Public site + customer portal** — booking, certifications, merch, account management
- **Staff admin panel** — session management, invoicing, grading, customers, analytics

Everything has been pre-planned. Your job is to build from the specs, not design as you go.

---

## Environments

This project has three environments. The application code is identical across all three.
Only environment variables differ. Never hardcode environment-specific values in code.

| Environment | Branch | URL | Supabase |
|---|---|---|---|
| Development | local | `http://localhost:3000` | Separate project |
| Staging | `staging` | `https://staging.superherocpr.com` | Separate project |
| Production | `main` | `https://superherocpr.com` | Separate project |

**All three environments have their own:**
- Supabase project (separate database — never shared)
- S3 bucket (`superherocpr-assets-staging` vs `superherocpr-assets`)
- PayPal credentials (sandbox for dev/staging, live for production)
- OAuth redirect URIs registered per environment in each platform's developer console

**`NEXT_PUBLIC_BASE_URL` must always reflect the correct environment.** It is used to
build roster correction links, OAuth callback URIs, and email links. A wrong base URL
breaks OAuth flows and emailed links silently.

Environment variables for staging and production are managed in the AWS Amplify console
per branch — not in committed files. See `Building/.env.example` for the full variable
list and notes on which vars differ between environments.

---

## The Planning Documents — Read These First

All planning documents live in `Building/` at the monorepo root. Before writing a
single line of code for any feature, read the relevant document.

| File | What it contains |
|---|---|
| `Building/schema.md` | Every database table, column, type, and constraint |
| `Building/schema-notes.md` | Relationships, workflows, API endpoints, email triggers, sidebar nav |
| `Building/FOLDER-STRUCTURE.md` | Exact file and folder layout for the entire project |
| `Building/DESIGN-SYSTEM.md` | Colors, typography, spacing, component patterns, dark mode |
| `Building/.env.example` | Every environment variable — includes staging vs production notes |
| `Building/PageGuides/*.md` | Build guides for public pages and customer portal |
| `Building/PageGuides/admin/*.md` | Build guides for all 22 admin pages |
| `Building/threats.md` | Security threat log — check before starting, update as you build |

**These documents are the source of truth.** When in doubt: stop, read the relevant doc,
then continue. Never guess.

---

## How to Start Each Task

This is the required workflow for every page, component, or API route you build.
Do not skip steps.

1. **Read the page guide.** The guide for the page you're building is in
   `Building/PageGuides/`. Read it completely before writing any code. It specifies
   architecture, data fetching, component structure, API routes, what NOT to do,
   and a definition of done checklist.

2. **Check the schema.** Open `Building/schema.md` and verify every table and column
   name you plan to use. Do not guess or recall from memory — always verify.

3. **Check the folder structure.** Open `Building/FOLDER-STRUCTURE.md` and confirm
   the exact file path for what you're building. Use that path. Do not invent new
   directories.

4. **Check the design system.** Open `Building/DESIGN-SYSTEM.md` for the correct
   Tailwind classes, colors, spacing, and component patterns. Do not invent styling
   — use what's documented.

5. **Check the threats log.** Open `Building/threats.md` and review any open threats
   relevant to the feature you're about to build. Some threats have already been
   identified and have prescribed resolutions — implement those resolutions as you go.

6. **Build exactly what the guide says.** Not more, not less. If you think something
   is missing or could be better, note it as a comment and raise it — don't silently
   add or change things.

7. **Check your own work against the Definition of Done.** Every page guide ends with
   a checklist. Before declaring a page complete, go through it line by line.

---

## Non-Negotiable Rules

These apply to every file you touch, without exception.

### TypeScript
- Strict mode. No `any`. Ever.
- If you don't know the type of a Supabase query result, derive it from `Building/schema.md`
  and write the interface explicitly. Do not use `any` as a shortcut.
- Interfaces for DB shapes live in `types/`. Define them once, import them everywhere.
- Pay special attention to array `.filter()` and `.map()` callbacks on Supabase results —
  this is where `any` most often creeps in. Type the parameter explicitly.

### Supabase Clients
- **Server components and API routes:** `import { createClient } from '@/lib/supabase/server'`
- **Client components:** `import { createClient } from '@/lib/supabase/client'`
- Never import the server client in a client component. Never import the browser client
  in a server component or API route.
- Admin API routes that bypass RLS (creating users, archiving accounts, etc.) must use
  the service role key — not the anon key. The server client handles this via env vars.

### Environment Variables
- Never hardcode URLs, credentials, or environment-specific values in code.
- Always use `process.env.VARIABLE_NAME`. Every variable used in code must exist
  in `Building/.env.example` with documentation.
- `NEXT_PUBLIC_BASE_URL` is used wherever the app needs its own URL. Use it — do not
  hardcode `https://superherocpr.com` anywhere in the codebase.

### File Paths
- All imports use the `@/` alias, which maps to `apps/web/`.
- Every file lives exactly where `Building/FOLDER-STRUCTURE.md` says it does.
- Do not create new directories or files outside the documented structure without
  raising it first.

### Styling
- Tailwind utility classes only. No inline styles. No CSS files (except global.css).
- Use the classes documented in `Building/DESIGN-SYSTEM.md`. Do not invent new color
  values or spacing patterns.
- Dark mode: `dark:` Tailwind variants throughout. Every color decision needs a
  dark mode counterpart.

### API Routes
- Always return explicit HTTP status codes. `200` for success, `400` for bad input,
  `401` for unauthenticated, `403` for unauthorized, `404` for not found, `409` for
  conflicts (duplicate, class full, etc.), `500` for server errors.
- Never return `{ success: false }` with a `200` status.
- Validate all required fields at the top of every POST handler before touching the DB.

### Error Handling
- Every Supabase operation should check for errors.
- API routes should never crash silently — log errors and return appropriate status codes.
- UI should handle loading, error, and empty states. These are documented in the guides
  and the design system. Implement all three.

---

## Known Failure Modes — Read This Carefully

This section is written directly to you, the AI building this. These are patterns
where Claude Sonnet specifically tends to go wrong on large projects. Be alert to them.

### 1. Hallucinating column names
**The failure:** Writing a Supabase query using a column name that sounds right but
doesn't exist in the schema — e.g. `profiles.name` instead of `profiles.first_name`,
or `bookings.status` instead of `bookings.cancelled`.
**The fix:** Before writing any query, open `Building/schema.md` and read the actual
column list for that table. Every time. Not just the first time.

### 2. Using `any` in filter callbacks
**The failure:** Writing `session.bookings.filter((b: any) => !b.cancelled)` to avoid
thinking about the type. This violates strict mode and hides real type errors.
**The fix:** Define an interface for the joined shape. If you're filtering bookings
within a session join, the type of `b` is derivable from the `bookings` table in
`Building/schema.md`. Write it out.

### 3. Wrong Supabase client in the wrong context
**The failure:** Importing the browser Supabase client in a server component (causes
hydration errors or auth bypass), or importing the server client in a `"use client"`
component (crashes at runtime).
**The fix:** Check whether the file starts with `"use client"`. If yes: browser client.
If no (or if it's an API route): server client. This is the only rule you need.

### 4. Building more than the guide specifies
**The failure:** Adding a feature, abstraction, or component that "seems useful" but
wasn't in the guide. This creates undocumented code that future sessions don't know
about, introduces inconsistency, and wastes time.
**The fix:** Build exactly what the guide says. If something seems missing, add a
`// TODO: [describe what seems missing]` comment and note it to the user. Do not
silently fill in gaps with your own judgment.

### 5. Rewriting files from scratch when asked to edit
**The failure:** When asked to modify an existing file, rewriting the entire thing
from memory instead of making surgical changes. This loses carefully considered
logic that was already there and introduces regressions.
**The fix:** Read the existing file before editing it. Make the minimum change needed.
Preserve everything that wasn't asked to change.

### 6. Forgetting auth guards
**The failure:** Building a page that requires authentication but omitting the redirect
for unauthenticated users, or building an admin page without the role check.
**The fix:** Every protected page guide explicitly specifies its auth guard. The dashboard
layout checks `archived` status. The admin layout checks role. These are documented —
implement them exactly as written.

### 7. Interface drift between sessions
**The failure:** Defining `BookingRecord` in one session, then redefining it differently
in a later session because you don't remember the first definition. Two components
then have conflicting interfaces for the same shape.
**The fix:** TypeScript interfaces for shared shapes live in `types/`. Always check
whether an interface already exists before defining a new one. If it does, import it —
don't redefine it.

### 8. Losing context in long sessions
**The failure:** Decisions and patterns established at the start of a long session get
forgotten by the end. Naming conventions drift. Patterns become inconsistent.
**The fix:** For tasks spanning many files, re-read the relevant page guide and schema
section at natural breakpoints — before starting each major component or API route.
The guide is always more reliable than your in-context memory of it.

### 9. Missing `await` on async DB operations
**The failure:** Forgetting `await` on a Supabase call, especially inside loops or
conditional branches. The query appears to run but returns a Promise, not data.
**The fix:** Every Supabase call is async. Every one needs `await`. Pay particular
attention to operations inside `for...of` loops (parallel-safe ops should use
`Promise.all` instead of loops anyway — see the guides for patterns).

### 10. Inventing routes that weren't planned
**The failure:** Creating a utility API route, hook, or helper function that wasn't
in the plan. Other pages then get built expecting it to exist in a specific shape,
creating an invisible dependency.
**The fix:** The API routes are fully documented in `Building/FOLDER-STRUCTURE.md`.
Build only those routes, at those paths. If you believe a new shared utility is
needed, raise it before creating it.

### 11. Hardcoding environment-specific values
**The failure:** Writing `https://superherocpr.com` directly in code instead of using
`process.env.NEXT_PUBLIC_BASE_URL`. The staging environment then silently builds links
pointing at production.
**The fix:** Every URL, domain, and environment-specific value comes from an env var.
No exceptions. If a var doesn't exist in `Building/.env.example`, add it there first,
then use it.

---

## Build Order

Start with the foundation. Never build a page before its layout is complete.
Never build a complex flow before the simple pages that share its components are working.

### Phase 1 — Foundation (build first, nothing else works without these)
1. `tailwind.config.ts` — from `Building/DESIGN-SYSTEM.md`. Get this right before any UI work.
2. `lib/supabase/server.ts` and `lib/supabase/client.ts` — Supabase client setup
3. `lib/constants.ts` — `OWNER_EMAIL` and any other hardcoded values
4. `types/` — all TypeScript interfaces (schedule, bookings, merch, certifications)
5. Root `app/layout.tsx` — Inter font, metadata defaults, dark mode script
6. `components/ui/` — Button, Badge, Input (shared primitives only)

### Phase 2 — Public Site Layout
7. `app/(public)/layout.tsx` — public header, footer, nav

### Phase 3 — Simple Public Pages (no interactivity)
8. `/about` — markdown bio rendering, static content
9. `/classes` — static class type cards
10. `/contact` — form + API route

### Phase 4 — Data-Driven Public Pages
11. `/schedule` — session listing + client-side filters
12. `/` (home) — hero, class types, social feed, instructor section
13. `/merch` — product catalog + cart + PayPal checkout

### Phase 5 — Booking Flow
14. `/book` through `/book/confirmation` — all 5 steps + confirm API route
    Build this as a unit. Don't start it until Phase 4 is complete.
    Read `Building/PageGuides/instructor-payment-routing.md` before building
    the payment step — routing logic must be built in from the start.

### Phase 6 — Customer Portal
15. `app/(public)/dashboard/layout.tsx` — auth guard, archived check, dashboard nav
16. `/dashboard` — overview widgets
17. `/dashboard/bookings`, `/certifications`, `/orders`, `/settings`

### Phase 7 — Admin Foundation
18. `app/(admin)/layout.tsx` — auth guard, role check, dark sidebar
19. `/admin` — dashboard page (01-admin-dashboard.md)

### Phase 8 — Admin Pages (follow numbered guide order)
20–41. Admin pages 02–22 in order, plus instructor payment settings
       When building `19-admin-settings.md`, also implement Section 5 from
       `Building/PageGuides/instructor-payment-routing.md`.

### Phase 9 — Public Tools
42. `/rollcall` — walk-in registration
43. `/roster/[session_token]` — roster correction
44. `/submit-roster` — company roster upload

### Phase 10 — Background Jobs
45. Facebook social feed cache refresh (cron job) — *deferred, see "Three Loose Ends"*
46. Daily access code regeneration at midnight — *implemented as a Postgres `pg_cron`
    job in `Building/migrations/0006_daily_access_code_cron.sql`. No HTTP route.*

---

## The Three Loose Ends

Three things were left deliberately unplanned and should NOT be built until
explicitly scoped:

1. **Google Calendar import** — `class_sessions.google_calendar_event_id` exists in
   the schema but the import mechanism was never designed. Do not build anything
   for this. Leave the column in place.

2. **Inspector role pages** — The `inspector` role exists but no pages were designed.
   The admin sidebar shows placeholder text. Do not invent inspector pages.

3. **Facebook API integration** — The `social_feed_cache` table exists and the home
   page reads from it, but the cron job that populates it from Facebook's Graph API
   was not planned in detail. Build the home page to handle an empty table gracefully.
   Plan the background job separately when the time comes.

---

## When You're Unsure

Stop. Do not guess. Do not invent. Do one of these instead:

- **Unsure about a column name?** Open `Building/schema.md`.
- **Unsure about a file path?** Open `Building/FOLDER-STRUCTURE.md`.
- **Unsure about a color or component pattern?** Open `Building/DESIGN-SYSTEM.md`.
- **Unsure about how a feature should work?** Open the relevant page guide in `Building/PageGuides/`.
- **Unsure which URL to use in code?** Use `process.env.NEXT_PUBLIC_BASE_URL`.
- **The guide doesn't cover something you need?** Note it explicitly and ask.
  Do not fill in the gap silently.

The entire purpose of the planning documents is to eliminate guesswork. Use them.

---

## A Note on Scope

This is a significant platform. Forty-plus pages, twenty-two admin guides, multiple
payment integrations, real-time features, and a mobile-adjacent rollcall flow.

Build it one guide at a time. Each guide was written as a self-contained specification.
Treat each page as its own task. Finish it — including all error states, loading states,
and the definition of done checklist — before starting the next one.

Resist the urge to build abstractions that span multiple pages before those pages are
built. Premature abstraction on a project this size creates invisible dependencies and
makes debugging harder. Build each page to spec, then refactor shared patterns once
you can see what's actually shared.

The guides are your contract. The schema is your source of truth. The design system
is your visual language. Everything you need is documented.
