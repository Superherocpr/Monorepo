# Maintenance Overhaul — Master Checklist

Working tracker for rebuilding project health monitoring. Created 2026-08-19.

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` confirmed broken, needs fix

Related: [`qa-todo.md`](qa-todo.md) · [`threats.md`](threats.md) · Todoist project
"SuperheroCPR Maintenance Schedule" (ID `6hCVVp7852998WxW`, 32 recurring tasks)

---

## 0. Confirmed live findings (2026-08-19 audit)

These are verified facts, not hypotheses. Each needs an action.

- [!] **`alert-stuck-payout-batches` timed out on production today.**
  2026-08-19 14:00 UTC, `status_code: null`, `timed_out: true`,
  "Timeout of 5000 ms reached. Total time: 5001.6 ms". A p1 financial safety net
  silently did not run. `cron.job_run_details` recorded it as **succeeded**.
- [!] **No `timeout_milliseconds` set on any of the 7 HTTP cron jobs.** All inherit
  pg_net's 5000ms default. Targets are Amplify SSR Lambdas, where cold starts
  routinely exceed that. Affects migrations 0007, 0021, 0026/0029, 0048, 0050, 0051, 0053.
- [!] **`cron.job_run_details.status` is false-green.** 7 of 8 jobs are fire-and-forget
  `net.http_post`; "succeeded" means Postgres queued the request, not that the
  endpoint did the work. Last 7 days showed 8/8 green while the above was failing.
- [!] **`net._http_response` self-prunes after ~6 hours.** Any polling-interval check
  (the current weekly cron task) is structurally incapable of ever seeing a failure.
- [!] **Todoist weekly cron task is stale.** Says "all 6 pg_cron jobs", lists 6 names,
  and states "Cert expiry reminders are NOT a cron job". Reality: **8 on production,
  7 on staging**. `cert-expiry-reminders` (0051), `alert-stuck-payout-batches` (0050),
  and `daily-ops-summary` (0053, prod-only by design) are all missing from the task.
- [!] **Todoist daily Resend task is stale.** Excludes cert reminders on the grounds
  that they are manually triggered. They have been automated since 0051.
- [x] **Memory corrected:** 0048/0049 are on *both* envs, not staging-only.
- [x] **Memory corrected:** both envs confirmed at **0055**, with 0053 prod-only
  by design.
- [x] **Noted:** comparing envs by migration *name* yields false positives — several
  were applied under different names per env (staging `add_discount_percent_to_class_sessions`
  vs prod `0028_discount_percent_catchup`; staging `class_assistants` / `unique_access_code`
  vs prod `0033_` / `0034_` prefixed). Compare by content/intent.

---

## 1. Feature → signal coverage map  ← STARTING HERE

The artifact that kills blind spots permanently: every feature, and what signal
proves it works. Gaps become visible as empty cells.

- [x] Build the map — 25 features scored against six signal types
- [x] Identify the empty cells and rank them by blast radius (8 ranked gaps)
- [x] Add a CLAUDE.md rule — now **§6 "Every feature ships with a health signal"**,
      plus item 6 on the pre-code checklist. Sections 6–9 renumbered to 7–10.
- [x] Mirror the rule into tracked source — `apps/web/CLAUDE.md` is gitignored, so
      the canonical copy lives in `feature-health-map.md` under "The rule"
- [ ] Decide whether to start tracking `apps/web/CLAUDE.md` (left ignored for now)
- [ ] Reconcile the map against the 32 existing Todoist tasks — retire, update,
      or add as appropriate

### Features with no maintenance representation today

booking flow · merch & orders · cert issuance · rollcall · roster upload &
Enrollware · contact & Zoho · blog & SEO · add-ons · team bookings (0055) ·
class requests · invoices · daily summary email · social feed · payment-failure log

Covered today: payouts, promo codes, threats log, infrastructure.

---

## 2. Cron outcome verification (heartbeat)

Replaces existence-checking with outcome-checking. Durable, immune to the 6h TTL.

- [ ] Create a `cron_run_log` table (job name, started/finished, ok/fail, duration,
      records touched, error)
- [ ] Each of the 7 HTTP cron endpoints writes a row on completion
- [ ] Set explicit `timeout_milliseconds` on all 7 `net.http_post` calls
- [ ] One query answering "did every job report in within its window?"
- [ ] Wire that query into the daily summary email
- [ ] Decide handling for `regenerate-instructor-access-codes` — the one pure-SQL
      job, where `job_run_details` *is* trustworthy
- [ ] Backfill-safe: confirm the alert that failed today actually fired or re-run it

---

## 3. CI — highest-value single item

41 test files exist (9 Playwright specs, 32 unit tests) and **nothing runs them**.
[`.github/`](../.github/) contains only `copilot-instructions.md`.

**Evidence this is already costing you:** `npx eslint lib app` currently reports
**16 errors and 55 warnings** across 9 files (blog editor, blog tag pages, the
admin reference, settings, the PayPal card section, add-booking). None are new —
they accumulated unnoticed precisely because `npm run build` never runs lint.
Clearing them is a prerequisite for making CI a merge gate rather than noise.

- [ ] `typecheck` + `lint` + `vitest` on every PR
- [ ] Playwright against staging on merge
- [ ] Preserve the `next build --webpack` constraint — Turbopack breaks
      `@aws-sdk/client-s3` on Amplify (all S3 routes 500)
- [ ] Confirm Amplify build and CI don't diverge in Node version / install step
- [ ] Decide branch protection: does CI gate merges, or just report?

---

## 4. SQL invariant canaries — BUILT (staging)

Migration **0056** adds `public.health_invariants()` — 12 checks, one round trip.
Wired into the daily summary email via `lib/health-invariants.ts`.

- [x] Bookings without payments (`booking_missing_payment`)
- [x] Payments without bookings (`payment_orphan_no_booking`)
- [x] Sessions over capacity (`session_over_capacity`)
- [x] Payout items not summing to batch totals (`payout_batch_total_mismatch`)
- [x] Batch fee vs sum of item fees (`payout_fee_total_mismatch`)
- [x] Certs issued with no expiry date (`cert_missing_expiry`)
- [x] Earnings referencing a missing batch (`earnings_orphan_batch`)
- [x] Team booking invoice consistency (`team_booking_company_no_invoice`)
- [x] Invoice paid/cancelled state coherence (2 checks)
- [x] Bookings referencing a missing session (`booking_orphan_session`)
- [x] Payouts webhook silence (`payout_webhook_silent`)
- [x] Alert threshold decided — critical vs warning, criticals ranked first and
      also written to `console.error`
- [x] Applied to **staging**, verified: 12 checks run, grants locked to `service_role`
- [x] **Applied to production**, verified: 12/12 clean, grants locked to `service_role`
- [x] Tuned `payout_fee_total_mismatch` after it flagged 4 denied batches on
      production. Denied batches legitimately carry a batch-header fee against
      zero item fees (funds were returned), and denied is terminal — so the
      unscoped check would have fired forever. Now scoped to `status='completed'`.
      Re-applied to both envs.
- [ ] ~~Promo redemptions exceeding `max_uses`~~ — **no such column exists**;
      promo codes have no redemption cap to check
- [ ] Orphaned S3 images vs merch rows — not done; needs an S3 listing, not SQL

**First run already found a real breach on staging:** a $1,200 company-mode team
booking with no invoice ever raised. See `feature-health-map.md`.

---

## 5. Credential & third-party liveness

Each of these fails *silently and partially* — e.g. `refresh-social-feed-cache`
returns 200 and caches nothing when the token is dead.

- [ ] `FACEBOOK_PAGE_ACCESS_TOKEN` — long-lived tokens expire ~60 days
- [ ] Zoho OAuth refresh token — revocable, and the contact inbox depends on it
- [ ] `PAYPAL_INVOICE_WEBHOOK_ID` — verify webhooks are actually being delivered
- [ ] `PAYPAL_PAYOUTS_WEBHOOK_ID` — same; per memory this may still be unset in
      Amplify, leaving the webhook route inert and the hourly sync carrying
      reconciliation alone. **Verify.**
- [ ] `GOOGLE_PLACES_API_KEY` — quota headroom
- [ ] `TURNSTILE_SECRET_KEY` — liveness
- [ ] Resend DKIM/SPF/DMARC — already a semiannual Todoist task, keep
- [ ] Build a weekly probe job that calls each with a cheap read and reports
      what's expiring

---

## 6. Error tracking & uptime

Replaces "skim logs daily" — a human doing a machine's job.

- [ ] Error tracking (Sentry or equivalent) — decide whether to adopt
- [ ] Synthetic uptime checks on `/`, `/book`, `/rollcall`
- [ ] Post-deploy smoke check — a green Amplify build does not mean the app works
- [ ] Business canary: bookings-per-day floor alert (zero bookings in 24h is a
      signal, not a quiet day)

---

## 7. Environment parity

- [ ] Check Amplify env vars against every `process.env.*` referenced in code
      (33 distinct vars found). The [`amplify.yml`](../amplify.yml) grep has a
      documented history of silently matching zero vars for prefix entries.
- [ ] Maintain an **allowlist of intentional differences** — `0053_daily_summary_cron`
      is production-only and must never reach staging (admins would get daily
      emails of fake data)
- [ ] Migration parity by content, not name (see finding above)

---

## 8. Supabase advisors

Free, catches missing RLS, and absent from the plan entirely.

- [ ] Run security advisors on both projects, triage
- [ ] Run performance advisors on both projects, triage
- [ ] Add to the recurring schedule

---

## 9. Todoist plan hygiene

The plan drifted because nothing keeps it in sync with the system.

- [ ] Fix the stale weekly cron task (6 → 8 jobs, correct names, note prod-only 0053)
- [ ] Fix the stale daily Resend task (cert reminders are automated now)
- [ ] Retire tasks the automation above makes redundant
- [ ] Add tasks for the uncovered features from §1
- [ ] Add a recurring "does this plan still match the system?" review

---

## 10. Pre-existing blockers worth clearing

From [`qa-todo.md`](qa-todo.md) — these block whole categories of testing:

- [ ] Staging admin login credentials fail (`danny@superherocpr.com`), which blocks
      all admin feature testing and any admin e2e coverage
- [ ] `NEXT_PUBLIC_PAYPAL_CLIENT_ID` blank locally — blocks payment-flow testing
- [ ] Contact form success path and account deletion never safely tested
