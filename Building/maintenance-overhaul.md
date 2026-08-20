# Maintenance Overhaul — Master Checklist

Working tracker for rebuilding project health monitoring. Created 2026-08-19.

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` confirmed broken, needs fix

Related: [`qa-todo.md`](qa-todo.md) · [`threats.md`](threats.md) · Todoist project
"SuperheroCPR Maintenance Schedule" (ID `6hCVVp7852998WxW`, 32 recurring tasks)

---

## 0. Confirmed live findings (2026-08-19 audit)

These are verified facts, not hypotheses. Each needs an action.

- [~] **`alert-stuck-payout-batches` timed out on production today.** Cause fixed
      (0057, 30s timeout). Whether that specific run's work completed is still
      unknown — tracked in the Deferred Fixes project.
  ORIGINAL:
  2026-08-19 14:00 UTC, `status_code: null`, `timed_out: true`,
  "Timeout of 5000 ms reached. Total time: 5001.6 ms". A p1 financial safety net
  silently did not run. `cron.job_run_details` recorded it as **succeeded**.
- [x] **FIXED (0057)** — all 7 now pass `timeout_milliseconds := 30000`. Verified
      pg_net's signature defaults it to 5000. All inherit
  pg_net's 5000ms default. Targets are Amplify SSR Lambdas, where cold starts
  routinely exceed that. Affects migrations 0007, 0021, 0026/0029, 0048, 0050, 0051, 0053.
- [x] **ADDRESSED (0057)** — `cron_run_log` + `cron_health()` now give an
      outcome-based signal. 7 of 8 jobs are fire-and-forget
  `net.http_post`; "succeeded" means Postgres queued the request, not that the
  endpoint did the work. Last 7 days showed 8/8 green while the above was failing.
- [x] **ADDRESSED (0057)** — heartbeats are captured at run time and retained
      180 days, so this no longer matters. Any polling-interval check
  (the current weekly cron task) is structurally incapable of ever seeing a failure.
- [x] **FIXED** — rewritten to verify the monitoring rather than the jobs.
      Was: "all 6 pg_cron jobs", listing 6 names,
  and states "Cert expiry reminders are NOT a cron job". Reality: **8 on production,
  7 on staging**. `cert-expiry-reminders` (0051), `alert-stuck-payout-batches` (0050),
  and `daily-ops-summary` (0053, prod-only by design) are all missing from the task.
- [x] **FIXED** — cert reminders no longer excluded. Was: excluded on the grounds
  that they are manually triggered. They have been automated since 0051.
- [x] **Memory corrected:** 0048/0049 are on *both* envs, not staging-only.
- [x] **Memory corrected:** both envs confirmed at **0055**, with 0053 prod-only
  by design.
- [x] **FIXED — THREAT-061 (self-inflicted, same day).** `cron_job_expectations`,
      created by 0057 earlier that day, shipped **without RLS**. Supabase grants
      anon/authenticated full DML on every `public` table by default, so anon
      could have UPDATEd `max_gap_minutes` over PostgREST and silently disabled
      overdue detection for every cron job. Caught by the first-ever advisor run.
      RLS enabled on both envs; 0057 amended. Zero public tables now lack RLS.
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

## 2. Cron outcome verification (heartbeat) — BUILT (staging + production)

Migration **0057**. Replaces existence-checking with outcome-checking. Durable,
immune to the 6h pg_net TTL.

- [x] `cron_run_log` table — job name, ran_at, ok, duration_ms, records_touched, error
- [x] All 7 HTTP cron endpoints write a row on completion, via the
      `withCronHeartbeat()` wrapper in `apps/web/lib/cron-heartbeat.ts`
- [x] Explicit `timeout_milliseconds := 30000` on all 7 `net.http_post` calls
      (confirmed pg_net's signature defaults it to **5000**)
- [x] `cron_health()` answers "did every job report in within its window?",
      driven by a `cron_job_expectations` table (max gap per job)
- [x] Wired into the daily summary email as a second banner
- [x] `regenerate-instructor-access-codes` handled — wrapped in
      `regenerate_access_codes_logged()` so the one pure-SQL job reports in too
      rather than being a special case someone has to remember
- [x] `prune_cron_run_log()` for 180-day retention
- [x] Applied to **both** envs; the `daily-ops-summary` block is guarded by an
      existence check so running 0057 on staging cannot create it there
      (verified: staging still has 0)
- [ ] Confirm the alert that failed on 2026-08-19 actually fired, or re-run it
- [ ] Consolidate the duplicated private `isCronRequest` helpers in the cron
      routes onto the shared one now exported from `lib/cron-heartbeat.ts`

**Note on first deploy:** until each job runs once after the code ships,
`cron_health()` reports it overdue. Daily jobs take up to 25h to clear. This is
correct behaviour (never-reported is genuinely unknown), and self-resolves.

---

## 3. CI — highest-value single item

41 test files exist (9 Playwright specs, 32 unit tests) and **nothing runs them**.
[`.github/`](../.github/) contains only `copilot-instructions.md`.

**Evidence this is already costing you:** `npx eslint lib app` currently reports
**16 errors and 55 warnings** across 9 files (blog editor, blog tag pages, the
admin reference, settings, the PayPal card section, add-booking). None are new —
they accumulated unnoticed precisely because `npm run build` never runs lint.
Clearing them is a prerequisite for making CI a merge gate rather than noise.

- [x] 16 lint errors cleared — `tsc`, lint, 398 unit tests all clean
- [x] `typecheck` + `lint` + `vitest` on every PR —
      `.github/workflows/ci.yml` (Node 22, `npm ci`, `apps/web` working-dir,
      `--webpack` constraint noted, concurrent runs cancelled)
- [x] Decision: CI **blocks merges** (required status check)
- [!] **Manual step required:** enable the required status check in GitHub.
      Go to: `github.com/Superherocpr/Monorepo` → Settings → Branches →
      Add rule for `main` → check "Require status checks to pass" →
      search for **`ci`** (that's the job name) → Save.
      Do the same for `staging` if you want it gated too.
- [ ] Playwright against staging on merge — deferred; needs a staging URL
      wired into Actions secrets
- [x] Preserve the `next build --webpack` constraint — Turbopack breaks
      `@aws-sdk/client-s3` on Amplify (all S3 routes 500). Comment in the
      workflow explains this; the build script in package.json already
      enforces it.
- [x] Node version matched — CI uses Node 22 (same as local); Amplify has no
      `.nvmrc`, so CI is currently ahead of it. Low risk for lint/test.
- [x] Decide branch protection: blocks merges (see manual step above)

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

## 8. Supabase advisors — RUN 2026-08-19

Immediately justified itself: it caught an ERROR-level finding within an hour of
the table being created.

- [x] Run security advisors on both projects, triage
- [x] **FIXED — THREAT-061.** `cron_job_expectations` (created by 0057 earlier
      the same day) shipped **without RLS**. Supabase grants anon and
      authenticated full DML on every `public` table by default, so RLS is the
      only thing making those grants inert. Anon could have UPDATEd
      `max_gap_minutes` via PostgREST and silently disabled overdue detection for
      every cron job. RLS enabled on both envs; 0057 amended so a replay cannot
      reintroduce it. Verified: **zero** public tables now lack RLS.
- [ ] Run performance advisors on both projects, triage
- [ ] Add to the recurring schedule (Todoist)

### Remaining findings — triaged, not yet actioned

**26 tables grant `anon` SELECT while having no anon read policy.** These are safe
*today* because RLS denies every row, but the grant is a loaded gun: the moment
anyone adds a permissive policy or drops RLS, the data is public. That is exactly
the failure mode of THREAT-061. Defence-in-depth fix is to revoke the grant on
tables that never serve unauthenticated reads:

`addon_class_types, addons, api_keys, booking_addons, bookings, certifications,
class_requests, contact_notes, contact_replies, contact_submissions,
cron_job_expectations, cron_run_log, invoice_activity_log, invoices, order_items,
orders, payments, preset_grades, promo_code_class_types, promo_code_sessions,
promo_codes, roster_uploads, session_addons, stock_adjustments, system_settings,
team_bookings`

Provably a no-op functionally — with no anon read policy, no unauthenticated
request can read these rows regardless of the grant.

**13 tables legitimately serve anon reads** and must keep the grant:
`blog_post_tags, blog_posts, blog_slug_redirects, blog_tags, cert_types,
class_sessions, class_types, locations, product_variants, products, profiles,
roster_records, social_feed_cache`.

- [→] **Deferred to the Todoist "SuperheroCPR Deferred Fixes" project**
      (ID `6hJ7hvWqw87jV85F`), with full context. Further analysis on 2026-08-19
      corrected the scope: **`contact_submissions` has an anon INSERT policy —
      it is the public contact form.** A blanket `REVOKE ALL FROM anon` across
      all 26 would break it. Correct split is 25 tables safe for a full revoke,
      plus `contact_submissions` where only SELECT/UPDATE/DELETE may be revoked.
- [ ] `auth_leaked_password_protection` is **disabled** — a dashboard toggle that
      checks new passwords against HaveIBeenPwned. Free win, needs a human click.
- [ ] `pg_net` is installed in the `public` schema (WARN). Pre-existing; moving an
      extension is riskier than the finding. Documented, deliberately not touched.

---

## 9. Todoist plan hygiene — DONE 2026-08-19

- [x] **Rewrote the stale weekly cron task.** It claimed "all 6 pg_cron jobs" and
      that cert reminders were not a cron. Now that heartbeat monitoring is
      automated, the manual task shifted from *checking the jobs* to *checking
      the monitoring hasn't drifted* — job list matches `cron.job` (8 prod /
      7 staging), nothing chronically overdue, and `max_gap_minutes` still
      matches each real schedule.
- [x] **Fixed the stale daily Resend task** — cert reminders have been automated
      since 0051 and are now the highest-volume send, not an excluded one.
- [x] **Added: Supabase advisors** (monthly, p1) with the accepted-findings list
      so known noise isn't re-triaged every time.
- [x] **Added: feature health coverage map review** (quarterly) — the recurring
      counterpart to the §6 rule, listing the still-open gaps.
- [x] **Added: third-party credential liveness** (weekly, p1) — closes §5's
      "nothing watches any of them".
- [ ] Retire or downgrade any remaining task the automation has made redundant
      (the daily payout-batch check is still valid: nothing yet watches batches
      stuck in `assumed_complete`)

**The deeper fix** is §1's CLAUDE.md rule plus the quarterly map review. The plan
drifted because shipping a feature had no step that touched it; now it does.

---

## 10. Pre-existing blockers worth clearing

From [`qa-todo.md`](qa-todo.md) — these block whole categories of testing:

- [ ] Staging admin login credentials fail (`danny@superherocpr.com`), which blocks
      all admin feature testing and any admin e2e coverage
- [ ] `NEXT_PUBLIC_PAYPAL_CLIENT_ID` blank locally — blocks payment-flow testing
- [ ] Contact form success path and account deletion never safely tested
