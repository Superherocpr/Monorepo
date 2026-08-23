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
- [x] **Resolved 2026-08-20 — the missed alert was inconsequential, and the
      heartbeat is now proven working.**

      *What the alert would have said:* production holds exactly **4** payout
      batches, all `denied`, created 2026-08-10 → 2026-08-17. These are the same
      four §4 investigated when tuning `payout_fee_total_mismatch`. `denied` is
      terminal and the funds were returned, so nothing is stuck in a recoverable
      state and no financial action was missed. The 2026-08-19 digest would have
      listed four batches that are still denied and still visible in the admin
      panel — and every daily run since would have re-sent the same list. No
      re-run needed.

      *Heartbeat validated end-to-end.* `cron_run_log` on production now holds real
      rows from the two high-frequency jobs, the first proof that 0057 works in
      production rather than just in principle:

      | Job | Runs | Last | All OK | Slowest |
      |---|---|---|---|---|
      | `notify-unclaimed-opportunities` | 4 | 23:00 UTC | ✅ | 641 ms |
      | `reconcile-instructor-payouts` | 5 | 22:15 UTC | ✅ | 1092 ms |

      Note the durations: **~1 s at worst against pg_net's old 5 s default.** That
      reinforces the original diagnosis — the 2026-08-19 timeout was a Lambda cold
      start, not slow work — and confirms the 30 s timeout in 0057 is ample.

      `alert-stuck-payout-batches` has no row yet purely because it runs daily at
      14:00 UTC and the heartbeat code only went live at 18:12 UTC today. Its first
      row lands tomorrow at 14:00 UTC; the daily jobs will fill in over the next
      25 hours exactly as §2's "first deploy" note predicted.
- [x] **Consolidated 2026-08-20.** Eight routes carried their own copy — six as a
      private `function isCronRequest`, two inlined inside a local `isAuthorized`
      (including `probe-credentials`, written earlier the same day). All six private
      copies were verified **byte-identical** to the shared helper before removal, so
      this was a pure deduplication with no behavioural change.

      The risk it removes is drift, not tidiness: `withCronHeartbeat` uses the shared
      helper to decide whether to write a heartbeat. Had a route's private copy ever
      diverged, the route would keep accepting cron calls while the heartbeat quietly
      stopped recording them — and `cron_health()` would report the job overdue with
      no visible cause. That is precisely the false signal §2 exists to eliminate.

      `process.env.CRON_SECRET` now appears in exactly two places: `cron-heartbeat.ts`
      (verifies it) and `payout-trigger.ts` (sends it outbound — a different job, left
      alone).

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
- [x] **Playwright now scheduled — `.github/workflows/e2e.yml` (2026-08-20).**
      Nightly 07:00 UTC (03:00 EDT, so results wait at the start of the day), on
      every push to `main`, and on manual dispatch. Kept out of the PR gate on
      purpose — `ci.yml` must stay fast; e2e boots a server and drives a browser.

      **It boots the app locally against staging Supabase rather than hitting a
      staging URL, and that is not a shortcut.** `tests/e2e/rollcall.spec.ts` — the
      suite's only outcome test — calls `test.skip()` unless the target is
      localhost, because it seeds staging Supabase directly. Point
      `PLAYWRIGHT_BASE_URL` at a deployed origin and that test silently skips: the
      run stays green while the best coverage in the repo quietly stops running.
      That is precisely the false-green this whole overhaul exists to remove, so
      the workflow uses the `webServer` path `playwright.config.ts` already assumes.

      **Scope is deliberately narrow — only the `guest` project runs.** `customer`
      and `admin` are gated behind the repo variable `RUN_AUTHENTICATED_E2E`
      because §10's blockers are still live: staging admin credentials fail, and
      `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is blank. A suite that is red every night
      trains everyone to ignore it; narrow and green beats broad and red. Flip the
      variable once those clear.

      **Three repo secrets — SET 2026-08-20, verified present:**
      `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`,
      `STAGING_SUPABASE_SERVICE_ROLE_KEY`. Staging values only; URL and publishable
      key read straight from the Supabase API for the staging project rather than
      copied from memory. The workflow still checks for them up front and fails
      with a readable message, so a future secret deletion is obvious rather than
      surfacing as an opaque dev-server crash.

      **Not yet runnable — waits on the merge.** GitHub only registers `schedule:`
      and `workflow_dispatch` for workflows present on the **default branch**, so
      `e2e.yml` living on `MaintenanceUpdate` is inert: it does not appear in the
      Actions tab and cannot be dispatched. Confirmed no syntax error. Nightly runs
      begin from the first 07:00 UTC after this merges to `main`, and the merge
      itself triggers the first run via the `push` trigger.

      The monthly Todoist task was rewritten from *run the suite* to
      *review the nightly results and widen coverage*.
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

**Audited 2026-08-20 by probing each service directly.** One dead credential found
(Google Places), one assumption corrected (Facebook), one partial config (Resend).

- [x] `FACEBOOK_PAGE_ACCESS_TOKEN` — **HEALTHY, and the premise here was wrong.**
      `debug_token` reports `is_valid: true`, `type: PAGE`, `expires_at: 0` — i.e.
      **never expires.** Issued 2026-04-24, still valid ~4 months later. Page tokens
      derived from a long-lived user token do not expire on a timer, so the "~60 day"
      note was incorrect. It can still be killed by a password change, permission
      revocation, or a Page role change — so it needs *liveness* monitoring, just not
      *expiry* monitoring. Scopes: `pages_show_list`, `pages_read_engagement`,
      `pages_read_user_content`, `public_profile`.
- [ ] Zoho OAuth refresh token — revocable, and the contact inbox depends on it.
      **Blocked this pass:** the refresh token is not an Amplify env var (only
      `ZOHO_CLIENT_ID`/`_SECRET`/`_REDIRECT_URI` are), so it lives in the database
      and the Supabase MCP is unauthorized in this session. Check by authorizing
      Supabase, or hit the token endpoint from a session that can read it.
- [ ] `PAYPAL_INVOICE_WEBHOOK_ID` — verify webhooks are actually being delivered.
      The ID **is** set and injected (build 74), so the route is configured; what is
      unverified is whether PayPal has ever delivered to it. Per the health map,
      `invoices` is empty, so this is *untested*, not proven broken.
- [x] `PAYPAL_PAYOUTS_WEBHOOK_ID` — **VERIFIED SET** (2026-08-20). Present on the
      Amplify app and confirmed injected in build 74's `.env.production`. The earlier
      note that it might be unset was wrong; the webhook route is configured. Whether
      PayPal is actually *delivering* to it is a separate question — covered by the
      `payout_webhook_silent` invariant.
- [!] `GOOGLE_PLACES_API_KEY` — **DEAD IN PRODUCTION. Address autocomplete has been
      broken and nobody knew.** Probing the exact endpoint the app calls returns:

      status: REQUEST_DENIED
      error_message: "You must enable Billing on the Google Cloud Project"

      Not a quota ceiling — **billing is disabled on the GCP project**, so every
      Places call is refused. Confirmed this is the production key, not a local one:
      the value in `.env.local` is byte-identical to the Amplify app-level
      `GOOGLE_PLACES_API_KEY`.

      **Blast radius — 3 address-entry surfaces, all degraded not broken:**
      `dashboard/settings` (customer profile address), `AddLocationPanel` and
      `LocationsClient` (admin location management). Nothing depends on coordinates —
      `places/details` only populates address/city/state/zip — so manual entry is a
      genuine fallback and no flow is blocked.

      **Why it stayed invisible:** `app/api/places/autocomplete/route.ts:81-86`
      catches the bad status, `console.error`s it, and returns a friendly 502
      ("Address lookup unavailable. Please enter the address manually."). Correct
      UX, zero alerting — the textbook §5 failure. A user assumes the feature was
      never there.

      **Fix is in Google Cloud, not this repo:** re-enable billing on the project
      that owns the key. Verify by re-running the probe and expecting `status: OK`.
- [~] `TURNSTILE_SECRET_KEY` — **SET 2026-08-20, redeploy pending.** Was unset, so
      `verifyTurnstileToken()` failed open and Cloudflare recorded 0 siteverify
      requests against 23 solved challenges. Added at "All branches" scope.
      **THREAT-062.** Takes effect on the next `main` build (env vars inject at
      build time). Note the client-side widget was already blocking the ordinary
      spam bots — this closes the direct-to-API gap beneath it.
- [~] Resend DKIM/SPF/DMARC — **partially configured; mail is almost certainly
      delivering, but on one leg instead of two.** Sending domain is
      `update.superherocpr.com` (from `RESEND_FROM_EMAIL`).

      | Record | State |
      |---|---|
      | DKIM `resend._domainkey.update.superherocpr.com` | ✅ present |
      | SPF on `update.superherocpr.com` | ❌ **absent — zero TXT records on that name** |
      | DMARC on `update.superherocpr.com` | ❌ absent, inherits root |
      | Root DMARC | ⚠️ `p=none`, `rua=mailto:rua@dmarc.brevo.com` |
      | Root SPF | `v=spf1 include:zohomail.com ~all` — authorizes Zoho only, not Resend/SES |

      DMARC passes on DKIM alignment alone, which is why nothing is bouncing. But
      SPF is a hard miss: subdomains do **not** inherit the parent's SPF, and the
      root record wouldn't authorize Resend anyway. That leaves DKIM as a single
      point of failure for all transactional mail (~20 send sites).

      Two pieces of stale config: the DMARC `rua` still points at **Brevo**, a
      provider no longer in use, so aggregate reports go to an address nobody reads;
      and a leftover `brevo-code` TXT sits on the root. With `p=none` there is no
      enforcement either.

      Actions: add SPF on `update.superherocpr.com` authorizing Resend, repoint
      `rua` to a mailbox someone actually reads, then consider `p=quarantine` once
      reports look clean.
- [ ] Build a weekly probe job that calls each with a cheap read and reports
      what's dead or expiring. **This audit is the argument for it:** three manual
      curl commands found a credential that has been dead in production for an
      unknown length of time. The same three calls on a schedule would have caught
      it the week it broke.

      **BUILT 2026-08-20 — code complete, migration not yet applied.**

      | File | Role |
      |---|---|
      | `apps/web/lib/credential-probes.ts` | 5 probes + pure `summarizeProbes()` |
      | `apps/web/lib/credential-notify.ts` | alert email, super admins only |
      | `apps/web/app/api/cron/probe-credentials/route.ts` | route, `withCronHeartbeat("probe-credentials")` |
      | `apps/migrations/0058_credential_probes.sql` | schedules Mon 12:00 UTC |
      | `apps/web/tests/unit/lib/credential-probes.test.ts` | 22 tests |

      Probes: Google Places, Facebook `debug_token`, Resend (key **and**
      sending-domain verification), Turnstile secret, Zoho refresh token.

      **The rule the module is built around:** assert on the provider's semantic
      verdict, never on HTTP status. Google returned **200** with `REQUEST_DENIED`
      in the body — a probe checking `res.ok` would have called that healthy for
      months. Verified by temporarily reintroducing exactly that mistake: the
      REQUEST_DENIED and OVER_QUERY_LIMIT tests failed with
      `expected 'healthy' to be 'dead'` while the other 20 passed, then reverted.

      Three deliberate design choices worth not undoing:
      - **Zero probes ≠ healthy.** `probesRun: 0` reports unhealthy, same reasoning
        as `checksRun: 0` in the invariants canary — a silent canary is not a
        well one.
      - **`unconfigured` is not actionable, `probe_failed` is.** Staging genuinely
        lacks some keys, so absence must not cry wolf; but an unreachable provider
        is an *unknown*, and unknown is never a pass.
      - **A missing `TURNSTILE_SECRET_KEY` reports `dead`, not `unconfigured`** —
        absence there means verification fails open (THREAT-062), which is a live
        hole rather than a disabled feature.

      **How a failure escalates without anyone reading email:** the route returns
      **502** when something is wrong, so the heartbeat records `ok=false`. Since
      `cron_health()` measures the gap since the last *successful* run, a
      credential left broken past 7d+3h surfaces the job as overdue in the daily
      digest's existing cron banner. No third banner was added — the escalation
      path already routes through one, and the alert email covers immediacy.

      **Migration 0058 APPLIED to both environments 2026-08-20.** Verified:
      `probe-credentials` active on both, schedule `0 12 * * 1`,
      `max_gap_minutes = 10260`. Production now has **9** cron jobs, staging **8**.
      Both were at 0057 beforehand; staging still correctly lacks 0053.

      ⚠️ **The schedule is live but the endpoint is not deployed yet.** Production
      is still serving build 74, which has no `/api/cron/probe-credentials`. Until
      the next deploy, the Monday run will 404, no heartbeat will be written, and
      `cron_health()` will report `probe-credentials` overdue in the digest. That
      is *technically accurate* — the job genuinely is not working — but it is
      expected noise, not a new fault. It self-resolves on the first deploy that
      ships the route.

      **Staging is scheduled but does not email.** `isProductionEnvironment()` in
      `lib/credential-notify.ts` gates the alert on the base URL being
      `superherocpr.com`. Reasoning: staging inherits nearly every credential from
      the app-level Amplify config, so it reaches the same verdict as production,
      and staging's `profiles` holds the same two **real** super_admin addresses —
      one dead key would otherwise send two identical emails a week to the same
      people, and a duplicated alert is a filtered alert. Staging still runs the
      probe and still writes a heartbeat, which remains a real canary for the route
      itself. Note staging has no digest either way, since 0053 is production-only.

      **After the next deploy:** trigger once by hand to give `cron_health()` a
      baseline. Expect 502 with `google_places` in `actionable` until GCP billing
      is restored — that is the probe working, not failing.

---

## 6. Error tracking & uptime

Replaces "skim logs daily" — a human doing a machine's job.

- [ ] Error tracking (Sentry or equivalent) — decide whether to adopt
- [ ] Synthetic uptime checks on `/`, `/book`, `/rollcall`
- [ ] Post-deploy smoke check — a green Amplify build does not mean the app works
- [ ] Business canary: bookings-per-day floor alert (zero bookings in 24h is a
      signal, not a quiet day)

---

## 7. Environment parity — AUDITED 2026-08-20

39 `process.env.*` references found across `apps/web/`. Cross-referenced against
the `amplify.yml` grep pattern. All vars categorised below.

**Method note — read the build log, not just the config.** The `amplify.yml` grep
is *intent*; the build log line `Env var names written:` is *truth*. A var can be
in the grep and still have no value set, or be set at app level and overridden per
branch. This audit only became reliable once both were compared. Source of truth
used here: Amplify app `dzmna7ztg21it` (us-east-2), build job **74** on `main`
(2026-08-20), which injected **22** vars.

- [x] Audit complete — verified against live Amplify config *and* the production
      build log, not inferred from the grep pattern alone
- [x] **FIXED — real production bug.** `TeamSignupClient.tsx` read
      `NEXT_PUBLIC_PAYPAL_ENVIRONMENT`, which is set **nowhere**. It resolved to
      `undefined`, so the ternary fell through to `"sandbox"` and handed
      `PayPalProvider` a sandbox environment alongside a **production** clientId and
      clientToken. Renamed to `NEXT_PUBLIC_PAYPAL_ENV` (confirmed injected, value
      `"production"`), matching the other three payment surfaces. See below.
- [x] `DATAFORSEO_` prefix added to the `amplify.yml` grep — forward-looking only;
      the vars are not set in Amplify at all, so the SEO check route stays inert
      until someone adds values.
- [x] **`TURNSTILE_SECRET_KEY` set in Amplify** (2026-08-20, "All branches" scope).
      Was in the grep with no value, so `verifyTurnstileToken()` failed open.
      **THREAT-062.** Effective on the next `main` build.
      **Method note:** added via the console UI, not the CLI —
      `aws amplify update-app --environment-variables` **replaces the entire map**,
      so a single-variable CLI call would have wiped the other 25 and taken
      production down. The console edit is additive. Use it for any future env var.
- [x] **`ENCRYPTION_KEY` — DECIDED 2026-08-20: leave it, documented.** Confirmed
      dead: zero references across `.ts`, `.tsx`, `.js` and `.yml` in the whole repo.
      Set at Amplify app level (with a stray **trailing space** in the value) and
      overridden cleanly on `main`.

      It is also **not in the `amplify.yml` injection grep**, so it never reaches the
      running app at all — it exists purely as Amplify console config and does
      literally nothing today.

      Not deleting it, on the reasoning that deletion buys nothing measurable (it is
      not injected, so it is not even in the SSR bundle's blast radius) while carrying
      a non-zero risk that something outside this repo — a script, a Lambda, a
      one-off tool — still reads it. Revisit and delete if that is ever ruled out.
      The trailing space is a latent trap if it is ever wired up: fix the value at
      the same time.
- [x] `S3_BUCKET_NAME` — staging inherits the app-level `superherocpr-assets-prod`
      and writes into the same bucket as production. **Confirmed intentional
      (2026-08-20):** one shared asset bucket for both environments is the design.
      Do not "fix" this by adding a staging override.
- [ ] Migration parity by content, not name (see finding above)

### The PayPal environment bug — what was actually wrong

Three payment surfaces read `NEXT_PUBLIC_PAYPAL_ENV`:
`book/payment/page.tsx`, `MerchClient.tsx`, `SessionDetailClient.tsx`. All correct.

`team/[share_token]/_components/TeamSignupClient.tsx` read
`NEXT_PUBLIC_PAYPAL_ENVIRONMENT` — a name that appears in no Amplify config and no
build log. The effective value was therefore:

```js
undefined === "production" ? "production" : "sandbox"   // → "sandbox"
```

That `"sandbox"` was passed to `<PayPalProvider environment={...}>` at both call
sites (the clientToken path and the clientId-only fallback), while `clientId`,
`clientToken`, and `PAYPAL_API_BASE` were all production. A production credential
against sandbox endpoints does not degrade gracefully — the SDK rejects it, so
per-seat team signup payments were most likely failing outright in production
rather than quietly charging the wrong account.

**Not caught by tests** because the component reads `process.env` at module scope
and no test asserts the resolved environment. **Not caught by typecheck** because
any `process.env.*` access is `string | undefined` and the ternary is valid either
way. This is exactly the failure class §7 exists to find.

### Gaps: in the grep, but no value set in Amplify

| Var | Consequence |
|---|---|
| `TURNSTILE_SECRET_KEY` | **THREAT-062** — captcha verification silently skipped |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Admin blog SEO check returns an error; prefix now in the grep, values still needed |
| `PLATFORM_FEE_PERCENT` | Falls back to the in-code default |
| `AWS_S3_REGION` | Falls back to hardcoded `"us-east-2"` — intended, see `lib/s3.ts` |
| `TWILIO_*` | Nothing set; no code path appears to depend on it |

### Intentional gaps (correct — no fix needed)

| Var | Why it's OK |
|---|---|
| `AWS_REGION` | Amplify SSR Lambda does **not** expose this to Next.js (documented in `lib/s3.ts`). Code falls back to `AWS_S3_REGION` (captured by `AWS_S3_` prefix) then hardcoded `"us-east-2"`. Intentional. |
| `NODE_ENV` | Set by Next.js/build system. Not injected; not needed. |
| `CI` | Set by GitHub Actions runner. Test-only; not in Amplify. |
| `PLAYWRIGHT_BASE_URL` | e2e test config. Not deployed. |
| `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` / `TEST_CUSTOMER_EMAIL` / `TEST_CUSTOMER_PASSWORD` | Playwright credentials. Not deployed. |

### Verified reaching production — the 22 vars in build 74's `.env.production`

`CRON_SECRET` · `FACEBOOK_PAGE_ACCESS_TOKEN` · `FACEBOOK_PAGE_ID` ·
`GOOGLE_PLACES_API_KEY` · `NEXT_PUBLIC_BASE_URL` · `NEXT_PUBLIC_PAYPAL_CLIENT_ID` ·
`NEXT_PUBLIC_PAYPAL_ENV` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` ·
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_TURNSTILE_SITE_KEY` · `OWNER_EMAIL` ·
`PAYPAL_API_BASE` · `PAYPAL_INVOICE_WEBHOOK_ID` · `PAYPAL_PAYOUTS_WEBHOOK_ID` ·
`PAYPAL_SECRET` · `RESEND_API_KEY` · `RESEND_FROM_EMAIL` · `S3_BUCKET_NAME` ·
`SUPABASE_SERVICE_ROLE_KEY` · `ZOHO_CLIENT_ID` · `ZOHO_CLIENT_SECRET` ·
`ZOHO_REDIRECT_URI`

**Resolves a §5 open question:** `PAYPAL_PAYOUTS_WEBHOOK_ID` **is** set and **is**
injected. The memory note suggesting it might be unset in Amplify was wrong — the
payouts webhook route is not inert for lack of configuration.

**Also confirms the build spec question:** the preBuild env-injection step ran, so
the repo's `amplify.yml` is what executes. The build spec stored in the Amplify
console is stale (no preBuild, no injection) but is correctly overridden by the
repo file. Worth deleting from the console to avoid confusing a future reader.

### Allowlist of intentional staging/production differences

- Migration `0053` (`daily_summary_cron`) — **production only**, must never reach
  staging. Admins would receive daily emails of fake data.
- `main` overrides `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ZOHO_REDIRECT_URI`,
  `ENCRYPTION_KEY`, `S3_BUCKET_NAME` at branch level; the app-level values are the
  staging ones. `staging` overrides only the two Supabase keys and inherits the rest.
- **One S3 bucket serves both environments** (`superherocpr-assets-prod`). Staging
  uploads land in the production bucket by design — confirmed 2026-08-20. This is why
  the weekly bucket-size Todoist check cannot attribute growth to an environment.

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
- [x] **Run performance advisors on both projects, triage — DONE 2026-08-20.**
      First-ever performance run. 49 findings on production: 8 WARN, 41 INFO.
      Triage below; the two zero-risk wins are already fixed (migration 0059).
- [x] **Security re-run after 0058 — both environments ERROR-free.** Production
      80 WARN / 28 INFO, staging 1 WARN / 28 INFO, **zero ERROR on either**. The
      0058 DDL introduced nothing, and THREAT-061 stays fixed.
- [x] **Add to the recurring schedule (Todoist) — already existed; now updated.**
      "Run Supabase security + performance advisors on both projects" (monthly, p1,
      id `6hJ7fQHwGHg45rx4`). Extended 2026-08-20 with a **numeric baseline**
      (security: 0 ERROR both envs, prod 80 WARN / 28 INFO, staging 1 WARN / 28 INFO;
      performance: 8 WARN / 41 INFO) so a future run can tell "same as always" from
      "something new landed" at a glance, plus the full accepted-findings list from
      this triage and the still-open `auth_rls_initplan` work.

      **Verification note:** searching Todoist for this task by keyword initially
      returned nothing, which nearly led to recording §9's claims as false. The
      search returns partial results with an unreliable `totalCount`. Confirm a task
      is absent by more than one query before concluding it was never created.

### Performance triage (production, 2026-08-20)

**Fixed — migration 0059, applied to both environments**

Two pairs of *byte-identical* indexes. Verified via `pg_indexes` before dropping,
and verified afterwards that exactly one of each survives:

| Table | Dropped | Kept |
|---|---|---|
| `instructor_payout_items` | `instructor_payout_items_batch_idx` | `idx_instructor_payout_items_batch_id` |
| `processed_webhook_events` | `processed_webhook_events_received_idx` | `idx_webhook_events_received_at` |

A duplicate index is pure cost — double write amplification on every insert, extra
storage, and the planner only ever uses one. Dropping one is functionally a no-op,
which makes this the safest class of schema change there is.

**Worth doing, but as its own reviewed change — 5 × `auth_rls_initplan` (WARN)**

`profiles` (3 policies: `profiles_auth_read_own`, `profiles_anon_insert_own`,
`profiles_auth_update_own`), `bookings` (`bookings_auth_read_own`), `orders`
(`orders_auth_read_own`) each re-evaluate `auth.<function>()` **per row**. The fix
is mechanical — wrap as `(select auth.uid())` so it evaluates once — and the gain
grows with table size.

Deliberately **not** bundled into 0059. These are live access-control policies on
customer data; a typo does not degrade performance, it changes who can read what.
That is the THREAT-061 failure class. It deserves its own migration, its own review,
and a verification query per policy.

**Deliberately not acting — 25 × `unused_index` (INFO)**

"Never used" is being reported for indexes on tables created days ago —
`cron_run_log` (0057, one day old), `team_bookings` and `bookings_team_booking_id_idx`
(0055, three days). Index usage counters measure observed traffic, so on a young
index the statistic reflects its *age*, not its usefulness. Dropping on this
evidence would be acting on a number that has not had time to mean anything.
Revisit after a few weeks of real traffic, and only for indexes on mature tables.

**Deliberately not acting — 16 × `unindexed_foreign_keys` (INFO)**

Real, but low-value at current volume: these cost on cascading deletes and joins,
and adding sixteen indexes carries its own write penalty. Reassess if any of these
tables grows or a slow query appears.

**Noted, not a finding — a near-duplicate the advisor correctly ignored**

`instructor_payout_items` also carries `idx_instructor_payout_items_instructor_id`
`(instructor_id)` alongside `instructor_payout_items_instructor_idx`
`(instructor_id, status)`. Not identical, so not flagged — but the composite covers
the single-column one as a leading-column prefix, so the narrow index is arguably
redundant. Left alone: it is smaller and marginally faster for pure `instructor_id`
lookups, and the call is genuinely close. Checked rather than assumed.

**Environment parity note**

Production reports 78 `pg_graphql_*_table_exposed` warnings; staging reports none,
despite an equivalent schema. Same root cause as the 26-table anon-grant item
already deferred to Todoist (default `public` grants), surfaced through the GraphQL
endpoint instead of PostgREST. The prod/staging asymmetry is unexplained and worth
a look when that deferred item is picked up.

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
- [x] **Retire or downgrade tasks the automation made redundant — DONE 2026-08-20.**

      **Rewritten + downgraded p1 → p3: "Verify third-party credentials and tokens
      are still live"** (weekly, Mon 12:00). Migration 0058's `probe-credentials`
      job runs at exactly that slot and does exactly that work, so the task was
      fully redundant. Retitled *"Confirm the credential probe is running and its
      findings are being acted on"* — the same shift from *doing the check* to
      *checking the checker* that §9 applied to the cron task. Its three remaining
      human steps: did the probe run, was a failing result acted on or filtered,
      and does the probe list still cover every credential the app uses.

      Also corrected four stale claims inside it: the Facebook token does **not**
      expire on a ~60-day timer, `PAYPAL_PAYOUTS_WEBHOOK_ID` **is** set,
      `TURNSTILE_SECRET_KEY` was unset entirely (THREAT-062), and
      `GOOGLE_PLACES_API_KEY` is dead.

      **Updated, not retired: "Check email deliverability (SPF/DKIM/DMARC)"**
      (bi-yearly). The probe checks Resend's *API key and domain-verified status*;
      it does not check DNS. Complementary, not redundant — Resend can report
      "verified" while the DNS underneath has drifted. Loaded the task with the
      audited state and four concrete actions, chiefly the missing SPF record.

      **Left alone deliberately:** the daily payout-batch check still earns its
      place — nothing automated watches batches stuck in `assumed_complete`.

**The deeper fix** is §1's CLAUDE.md rule plus the quarterly map review. The plan
drifted because shipping a feature had no step that touched it; now it does.

---

## 10. Pre-existing blockers worth clearing

From [`qa-todo.md`](qa-todo.md) — these block whole categories of testing:

- [ ] Staging admin login credentials fail (`danny@superherocpr.com`), which blocks
      all admin feature testing and any admin e2e coverage
- [ ] `NEXT_PUBLIC_PAYPAL_CLIENT_ID` blank locally — blocks payment-flow testing
- [ ] Contact form success path and account deletion never safely tested
