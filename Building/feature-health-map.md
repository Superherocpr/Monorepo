# Feature → Health Signal Coverage Map

Every feature, and what signal would tell you it broke. Built 2026-08-19.
Companion to [`maintenance-overhaul.md`](maintenance-overhaul.md).

## Signal legend

| Code | Signal | What it proves |
|---|---|---|
| **U** | Unit test | Logic is correct in isolation |
| **E**° | e2e — smoke | The page renders (proves almost nothing about behaviour) |
| **E**● | e2e — outcome | A real action completes and the result is asserted |
| **C** | Cron / automated alert | Something machine-checks it on a schedule |
| **A** | Admin surface | A human *could* notice, if they happen to look |
| **I** | SQL invariant | Data corruption would be caught (none exist yet) |
| **M** | Manual Todoist task | A human is scheduled to look |

**A is not a signal.** It's the possibility of a signal. Counting it as coverage is
how features go dark for weeks. It's tracked here to show what's *only* watched
that way.

---

## The rule

> **Every feature ships with a health signal.** A feature nobody can tell is
> broken is a feature that will break silently. Before a feature is done, it must
> have at least one signal that would **fail loudly** if it stopped working.
>
> An admin page where someone *could* notice is **not** a health signal. Neither
> is a test that only asserts a page loads. The signal must assert an outcome.
>
> Pick at least one: an **SQL invariant** in the nightly canary (the feature
> writes data that must stay internally consistent) · an **outcome e2e test**
> (it's a user flow that can be driven end to end) · a **cron/alert** (it's
> scheduled, or its failure mode is silence) · a **unit test** (pure logic —
> necessary, never sufficient on its own).
>
> Model outcome e2e tests on `apps/web/tests/e2e/rollcall.spec.ts`. Do not add
> tests in the style of `admin.spec.ts`.
>
> **When you add or materially change a feature, update this file in the same
> task:** add the row, fill in the signals, state the verdict honestly. Shipping
> without a signal is acceptable if you say so here and leave a `// TODO:`. An
> acknowledged gap is fine; an invisible one is not.
>
> Inbound integrations (webhooks, third-party callbacks) need extra care —
> nothing in the app initiates them, so failure produces silence that looks
> exactly like a quiet day. They always need a heartbeat or an invariant, never
> just a log line.

This is the canonical, version-controlled copy. `apps/web/CLAUDE.md` §6 carries
the same rule for agent sessions, but that file is gitignored
(`apps/web/.gitignore`, under `# Claude`) and therefore does not survive a fresh
clone — so this file is the one that travels with the repo.

---

## Money

| Feature | U | E | C | A | I | M | Verdict |
|---|---|---|---|---|---|---|---|
| Booking + PayPal checkout | ✅✅ | ○ smoke | — | ✅ | ✅ | — | **No e2e test completes a payment** (blocked by blank `NEXT_PUBLIC_PAYPAL_CLIENT_ID`). The card form itself now has 6 unit tests (`PayPalCardPaymentSection.test.tsx`) covering the submit gate, the invalid-field block, and latest-`onApprove` delivery — the SDK is mocked, so this proves the component's logic, not the PayPal round trip |
| Payment-failure log | ✅ | — | — | ✅ | ✅ | — | Shipped last commit; only signal is someone opening `/admin/payments` |
| Invoices | ✅ | — | — | ✅ | ✅ | — | No outcome test on create/send/mark-paid |
| **PayPal invoice webhook** | — | — | — | ~ | — | — | Never fired in prod — but `invoices` is empty, so **untested, not proven broken** |
| **PayPal payouts webhook** | — | — | — | — | ✅ | — | ✅ **Confirmed live** — received events 2026-08-17. Now covered by `payout_webhook_silent` |
| Payouts | ✅✅✅✅ | ○ smoke | ✅✅✅ | ✅ | ✅✅✅ | ✅✅ | **Best-covered feature.** The model for everything else |
| Promo codes | ✅ | — | — | ✅ | — | ✅ | Quarterly abuse audit only. No `max_uses` column exists, so there is no redemption cap to check |
| Add-ons | ✅ | — | — | ✅ | — | — | No e2e; revenue-affecting |
| Merch & orders | ✅ | ○ cart UI | — | ✅ | — | — | No order ever completes in a test |
| **Team bookings** (0055) | ✅ | — | — | **✗** | ✅ | — | Admin surface still missing, but now has an invariant — see below |

### Team bookings — was invisible, now partially covered

Shipped 2026-08-17. It takes money via shareable group links and CSV upload. It has
3 API routes, 1 public page (`/team/[share_token]`), 1 unit test, and **no admin page
anywhere** — `grep` across `app/(admin)` finds no reference.

As of 2026-08-19 it has one real signal: `team_booking_company_no_invoice` in the
nightly canary. That check earned its place immediately — it found a breach on
staging on its first run: a $1,200 "Acme Hospital" company-mode booking from your
2026-08-17 testing with **no invoice ever raised**. No invoice row exists for that
session at all, so `createTeamInvoice` failed outright, logged
`invoice creation failed (non-fatal)` to console, and returned success. Nothing
told anyone.

Still open: the operator cannot see group bookings anywhere in the product. That's
a product gap, not just a monitoring one.

---

## Operations

| Feature | U | E | C | A | I | M | Verdict |
|---|---|---|---|---|---|---|---|
| Sessions & scheduling | ✅✅ | ○ smoke | ✅ | ✅ | ✅✅ | — | Cron covers unclaimed escalation only |
| **Class time correctness** | ✅✅ | — | — | ✅ | — | — | ⚠️ Unit-only — see note below |
| Class requests | — | — | — | ✅ | — | — | No test of any kind |
| **Rollcall / check-in** | ✅✅ | **● outcome** | ✅ | ✅ | — | — | ✅ **The one feature tested properly** — asserts `roster_record` confirmed and realtime broadcast |
| Roster upload / submit | ✅ | ○ lookup | — | ✅ | — | — | Parse tested; submission path not |
| Enrollware integration | ✅✅ | ○ smoke | — | ✅ | — | ✅ | Annual deprecation check; external, brittle |
| Certifications | ✅ | ○ smoke | ✅ | ✅ | ✅ | — | Cron sends reminders; issuance untested |
| Grading / CCF | — | — | — | ✅ | — | — | No test of any kind |

### Class time correctness (added 2026-08-22)

Class times are stored as **floating wall-clock values**: the time the instructor
typed is stored literally and read back verbatim everywhere, with no timezone
conversion. The contract lives in `apps/web/lib/business-time.ts`; migration
`0060_floating_session_times.sql` converted the existing rows.

This exists because a customer reported a booking-confirmation email showing
1:00 PM for a 9:00 AM class. `/book` rendered in the student's browser (Eastern)
while the email rendered on a UTC server — same formatting code, four-hour
disagreement.

**Signal:** `tests/unit/lib/business-time.test.ts` (22 tests). They assert exact
wall-clock strings ("9:00 AM"), which only hold while the helpers pin UTC — so a
regression that reintroduced a timezone conversion fails them.

`pnpm test:unit:tz` re-runs that file under five process timezones (UTC, Eastern,
Pacific, Tokyo, Sydney) and is the sharpest version of the check: the original bug
was precisely that the same code gave different answers in the browser and on the
UTC email server. Verified passing in all five on 2026-08-22. **This is not wired
into CI** — it is a command someone must run.

**Honest gap:** this is unit-only. The unit tests prove the helpers are correct;
nothing asserts that every *call site* uses them. A future call site that
hand-rolls `toLocaleTimeString` without `timeZone: "UTC"` would be wrong and
silent. Two things that would close it:

- `// TODO:` An outcome e2e test that books a session and asserts the time shown
  on `/book`, on the confirmation page, and in the captured email body all match
  the time the session was seeded with.
- `// TODO:` A lint rule banning bare `toLocaleTimeString`/`toLocaleDateString`
  on a `starts_at`/`ends_at` value outside `lib/business-time.ts`.

Neither is built. Until one is, the coverage here is "the helpers are right",
not "the app uses them everywhere".

---

## Communications

| Feature | U | E | C | A | I | M | Verdict |
|---|---|---|---|---|---|---|---|
| Transactional email (Resend) | — | — | ✅ | — | — | ✅✅ | Was "zero automated checks". The weekly credential probe now verifies the API key **and** that the sending domain is still `verified` |
| Contact form / Zoho | ✅✅ | ○ validation | ✅ | ✅ | — | — | Was "token can be revoked with no signal". The probe now exchanges the refresh token weekly and alerts if Zoho refuses it |
| Daily summary email | — | — | ✅ | ~ | — | — | Its own arrival is the signal — but nobody's alerted if it *doesn't* arrive |
| Social feed | ✅ | ○ presence | ✅✅ | ✅ | — | — | Dead FB token → 200 + empty cache. Refresh cron, **plus** weekly `debug_token` liveness check |
| **Third-party credentials** | ✅ (22) | — | ✅ | — | — | — | New 2026-08-20. Weekly probe of 5 credentials; 502 on failure escalates through `cron_health()` into the digest |

---

## Platform

| Feature | U | E | C | A | I | M | Verdict |
|---|---|---|---|---|---|---|---|
| Auth / roles / RLS | ✅✅ | ● redirects | — | ✅ | — | ✅ | Redirect assertions are real; quarterly RLS review |
| Blog / SEO | — | — | — | ✅ | — | ✅ | No test; quarterly Lighthouse |
| Analytics | — | ○ smoke | — | ✅ | — | — | — |
| File uploads / S3 | — | — | — | ~ | — | ✅ | Weekly bucket-size check only. Turbopack breaks all S3 routes — a known live footgun |

---

## What the map exposes

**1. The test suite has the same disease as the monitoring.**
Of 41 test files, the e2e layer is overwhelmingly existence-checking:

- `admin.spec.ts` — **19 tests, all "page loads"**. Zero admin *features* are tested.
- `public-pages.spec.ts` — 17 tests, near-all page loads
- `booking-flow.spec.ts` — 4 tests, none reach payment
- `merch.spec.ts` — 6 tests, cart UI only, no order completes

`rollcall.spec.ts` is the exception and the template: it checks a student in and
asserts the database row. **Rollcall is the only feature where a passing suite
means the feature works.**

**2. Webhooks are the darkest corner.** Both PayPal webhooks have no unit test,
no e2e, no cron, no invariant. They're inbound — nothing in the app initiates
them — so a broken one produces *silence*, which is indistinguishable from a
quiet day.

**3. Coverage is inversely correlated with recency.** Payouts (Jul 30) is
well-covered because it was built after a real incident. Team bookings (Aug 17)
and payment-failure logging (Aug 18) have almost nothing. Without a rule tying
shipping to health signals, every new feature starts dark.

**4. Six features have no test of any kind:** class requests, grading/CCF,
transactional email, blog, both PayPal webhooks.

---

## Ranked by blast radius

| # | Gap | Why it ranks here |
|---|---|---|
| 1 | **Team bookings fully invisible** | Takes money, no admin surface, 2 days old, subtle capacity logic |
| 2 | **PayPal payouts webhook** | May be inert entirely; real money already went DENIED once |
| 3 | **PayPal invoice webhook** | Silent failure = invoices never mark paid = revenue leak |
| 4 | **No booking completes in any test** | The primary revenue path |
| 5 | **Transactional email unmonitored** | ~20 send sites; silent non-delivery |
| 6 | **Admin suite is 19 page loads** | Gives false confidence that admin is covered |
| 7 | **Cron false-green** | Confirmed live failure today (see checklist §0) |
| 8 | **Class requests / grading untested** | Operational, not financial |

---

## Proposed fills

Cheapest-first, since several of these collapse multiple gaps at once.

**SQL invariants** (fills the entire `I` column, one nightly job)
Catches #1, #3, #4 partially — corrupt or missing data shows up regardless of
which code path failed. Bolts onto the daily summary email, which already runs
and already queries revenue, bookings, and invoices.

**Webhook heartbeat** (#2, #3)
Log every inbound webhook receipt. "No PayPal webhook in N days" is then a
detectable condition. Same pattern as the cron heartbeat.

**Promote e2e from smoke to outcome** (#4, #6)
Not more tests — better ones. Use `rollcall.spec.ts` as the template. Requires
clearing the two blockers in `qa-todo.md` first: staging admin credentials and
the blank PayPal client ID. Sandbox PayPal makes a real booking assertable.

**Team bookings admin surface** (#1)
Arguably a product gap, not just a monitoring one — the operator can't see group
bookings at all today.

**CLAUDE.md rule** (prevents recurrence)
Shipping a feature includes declaring its health signal. This is the fix for the
root cause; everything above is remediation.

---

## Shipped 2026-08-19

**CLAUDE.md §6 — "Every feature ships with a health signal."** Codifies that an
admin page is not a signal and a page-load test is not a signal, points at
`rollcall.spec.ts` as the template, and adds item 6 to the pre-code checklist.
Sections 6–9 renumbered to 7–10.

**Migration 0056 — `public.health_invariants()`.** Twelve cross-table consistency
checks in one SECURITY DEFINER function. Applied to **staging**; production
pending.

Design points worth remembering:

- It returns **every** check with its breach count, not only the failures. A
  canary that goes quiet when healthy is indistinguishable from a canary that
  died, so `checksRun: 0` is rendered as "checks did not run" — explicitly *not*
  an all-clear.
- Grace windows (1h, 6h, 24h) on anything with an async follow-up step, so a row
  observed mid-write is not reported as corruption.
- `REVOKE ... FROM PUBLIC` first — revoking from `anon`/`authenticated` alone is a
  silent no-op. Verified post-apply: only `service_role` and `postgres` hold EXECUTE.
- `search_path` pinned, per migration 0047.

**`lib/health-invariants.ts`** + 11 unit tests. The pure `summarizeInvariants()`
holds the reporting logic so it is testable without a database. Full suite: 375
tests passing, typecheck and lint clean.

**Daily summary email** carries a health banner in three states — all-clear,
breached, or did-not-run. Critical breaches also `console.error` so they are
greppable without opening an inbox.

**Moved to the bottom 2026-08-20.** It originally rendered above revenue, on the
reasoning that a breach should be above the fold. The owner's call reversed that:
the digest goes to every super_admin and manager, most of whom do not know what
these checks mean, so leading with them buried the business numbers people
actually open the email for. Both banners now sit last under a "System checks"
heading, with a line saying most admins need take no action.

The tradeoff is accepted rather than overlooked — a breach is now below the fold.
It is still not silent: the banner renders red, criticals still `console.error`,
and credential or cron failures escalate independently through the probe alert
email and `cron_health()`. This email is the summary; it is not the alarm.

Also corrected: the route docstring claimed the cron fires at 12:00 UTC; migration
0053 and `cron.job` both say 11:00 UTC.

**Migration 0057 — cron heartbeat.** Applied to **both** environments.

- `cron_run_log` + `cron_health()` + a `cron_job_expectations` table holding each
  job's allowed gap. All 7 HTTP routes now write a completion row through
  `withCronHeartbeat()`; the digest carries a second banner for overdue jobs.
- **`timeout_milliseconds := 30000` on all 7 jobs.** pg_net's signature confirms
  the default is `5000` — which is what caused the 2026-08-19 failure. None of
  the original migrations set it.
- The wrapper deliberately **does not** log manual admin triggers. Counting one
  would mask a dead schedule: someone clicks the button, the job looks healthy,
  and nobody notices the cron stopped firing.
- The one pure-SQL job is wrapped in `regenerate_access_codes_logged()` so it
  reports in alongside the rest instead of being a special case.
- The `daily-ops-summary` block is guarded by an existence check, so running 0057
  on staging cannot create the production-only job there. Verified.

This also changed one existing test's premise: the unclaimed-opportunities route
now writes a heartbeat even when it self-gates off-schedule. That's intended —
"ran and did nothing" must be distinguishable from "never ran" — so the test was
sharpened to assert no *opportunity* queries rather than no DB calls at all.

## Shipped 2026-08-20

**Weekly credential probe** (`probe-credentials`, migration 0058 — written, not
yet applied). Closes §5's "nothing watches any of them" for five third-party
credentials: Google Places, Facebook page token, Resend key + sending domain,
Turnstile secret, Zoho refresh token.

It exists because a manual audit that day found **`GOOGLE_PLACES_API_KEY` dead in
production** — Google refusing every call because billing was disabled on the GCP
project. Address autocomplete had been broken on three surfaces for an unknown
length of time. Nothing alerted, because the route degrades politely to "enter the
address manually" and logs to a console nobody reads. Three curl commands found
it; this is those three curl commands on a schedule.

The design rule, and the reason the probe is not just an uptime check: **assert on
the provider's semantic verdict, never on HTTP status.** Google answered **HTTP
200** with `"status": "REQUEST_DENIED"` in the body. A monitor checking `res.ok`
would have reported healthy throughout — worse than no monitor, because it
manufactures confidence. A test asserts exactly this, and was verified by
temporarily reintroducing the mistake.

Two properties carried over from the invariants canary, for the same reason:
`probesRun: 0` reports **unhealthy** (a silent canary is not a well one), and an
unreachable provider reports `probe_failed` rather than passing — unknown is never
a pass. Conversely `unconfigured` is deliberately *not* actionable, since staging
legitimately lacks some keys and a banner that cries wolf daily stops being read.

Failure escalates without depending on anyone reading email: the route returns
**502**, the heartbeat records `ok=false`, and because `cron_health()` measures the
gap since the last *successful* run, a credential left broken surfaces the job as
overdue in the digest's existing cron banner.

### What the invariants do not yet cover

Merch orders, add-ons, blog, class requests, grading/CCF, contact/Zoho, and
transactional email have no invariant — several have no natural one, and need an
outcome test or a heartbeat instead.
