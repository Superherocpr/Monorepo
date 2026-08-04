# SuperheroCPR — Maintenance Schedule

A cadence for keeping the platform healthy, secure, and financially accurate — built around SuperheroCPR's actual stack (Next.js · Supabase · PayPal · AWS Amplify · Resend) and the patterns already in `CLAUDE.md` (the threat log, the admin reference sync rule).

Treat Daily and Weekly as quick glances meant to catch problems while they're small. The further down the list, the more deliberate the time block should be.

## Daily *(~5 minutes)*
- [ ] Confirm the latest AWS Amplify deploy succeeded — no failed builds sitting unnoticed
- [ ] Skim Supabase/application logs for new error types or spikes vs. the normal baseline
- [ ] If a PayPal payout batch ran today, confirm it didn't land in "needs review" or stay unconfirmed past the usual sync window
- [ ] Check Resend for bounced or failed sends (booking confirmations, cert reminders, invoices)

## Weekly *(~20–30 minutes)*
- [ ] Review everything logged to `Building/threats.md` this week — sanity-check that nothing rated 6-or-below actually deserved the 7+ stop-and-alert treatment
- [ ] Run `pnpm audit` and triage any new high/critical advisories
- [ ] Confirm the hourly payout-sync job and the cert-expiry-reminder job are both still running (not silently stuck or paused)
- [ ] Walk through booking + PayPal checkout and session creation end-to-end in staging
- [ ] Check Supabase row/storage usage and the S3 merch-image bucket against plan limits

## Monthly
- [ ] Apply safe patch/minor dependency bumps (`pnpm outdated` → update → run full test suite)
- [ ] Run the complete Playwright e2e suite against a production-like build, not just whatever subset CI runs by default
- [ ] Reconcile PayPal payouts — confirm every batch marked "assumed complete" has since been confirmed by PayPal; chase any that haven't
- [ ] Diff `app/(admin)/admin/reference/page.tsx` against what actually shipped this month, to catch anything rule 5 should have caught in the moment
- [ ] Verify Supabase automated backups are running, and spot-check that one is actually restorable
- [ ] Review Supabase/AWS/Resend/PayPal cost trends for anything approaching a plan limit

## Quarterly
- [ ] Compare Supabase Row-Level Security policies against the four admin roles (`super` / `manager` / `instructor` / `all`) — confirm no drift between DB-level policy and code-level checks
- [ ] Rotate what's safely rotatable: Enrollware bookmarklet keys, staging/test API keys
- [ ] Run a Lighthouse/Core Web Vitals pass on the public booking flow and blog
- [ ] Check `lib/` for utilities added this quarter that shipped without unit tests, and confirm nothing in the existing suite has been skipped or commented out (rule 9)
- [ ] Load-check bulk session create and checkout if booking volume has grown
- [ ] Audit promo code activity for abuse patterns — stacking attempts, expired-code use, how often the anti-tampering guard fires

## Bi-Yearly *(every 6 months)*
- [ ] Plan and land one deliberate framework bump (Next.js, React, or Tailwind) rather than letting several versions compound
- [ ] Run an actual disaster-recovery drill: restore a Supabase backup into a scratch environment and confirm the app boots against it
- [ ] Re-read `CLAUDE.md` itself — confirm the stack list, rules, and role definitions still match reality
- [ ] Full accessibility pass on public-facing pages (booking, blog, contact)
- [ ] Check SPF/DKIM/DMARC status for Resend — deliverability degrades quietly if these lapse
- [ ] Review AWS Amplify environment variables for stale or deprecated entries

## Yearly
- [ ] Check every third-party integration for deprecation notices: PayPal API version, Enrollware, Zoho Mail, Resend, Supabase
- [ ] Review data retention — how long archived customers, past sessions, and expired certs are actually kept vs. how long they should be
- [ ] Revisit the Privacy Policy / Terms of Service against what the app currently collects and does
- [ ] Rotate long-lived credentials: AWS IAM keys, Supabase service role key, PayPal app secret
- [ ] Step back and ask whether the current architecture still fits the business, or whether a feature (payouts, merch, certs) has outgrown its current shape
