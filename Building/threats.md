# Superhero CPR — Security Threat Log

This file is maintained automatically during development.
Every identified security vulnerability is logged here with a threat level from 0–10.

**Threat levels:**
- **0–3** Low — Minor issue, low exploitability or minimal impact
- **4–6** Medium — Should be addressed before launch, not immediately critical
- **7–10** High — ⚠️ USER ALERTED — Address before proceeding

When a threat is resolved, mark it **[RESOLVED]** with a note on how it was fixed.
Resolved threats are then removed from this file — see git history for the full record.

---

## ⚠️ HIGH SEVERITY — Address Before Proceeding

---

### THREAT-001
**File:** `app/api/payments/oauth/[platform]/callback/route.ts` and all webhook handlers
**Discovered:** 2026-04-21
**Threat Level:** 9/10
**Status:** [N/A — 2026-05-15] No webhook handler routes exist in the codebase. Invoices are marked paid via authenticated admin actions only. Re-evaluate if/when payment-platform webhooks are added.

**Description:**
The invoice payment webhook handlers (PayPal, Square, Stripe, Venmo) are not specified to verify the webhook signature before acting on the payload. These endpoints mark invoices as `paid` in the database when called.

**Attack Vector:**
An attacker who knows the webhook URL (which is predictable from the platform OAuth redirect URI pattern) can send a crafted POST request to any webhook endpoint claiming any invoice has been paid. The system would mark that invoice as paid without any actual money changing hands. The instructor receives a "paid" notification. The recipient keeps their money.

**Resolution:**
Every webhook handler must verify the request signature using the platform's provided verification method before touching the database:
- PayPal: Verify `PAYPAL-TRANSMISSION-SIG` header using `PAYPAL_INVOICE_WEBHOOK_ID`
- Square: Verify `x-square-hmacsha256-signature` header
- Stripe: Verify `stripe-signature` header using `stripe.webhooks.constructEvent()`
- Venmo: Same as PayPal

Reject any webhook with an invalid or missing signature with a `400` response — do not process it.

---

### THREAT-051
**File:** `apps/web/app/api/rollcall/session-students/route.ts`, `apps/web/app/api/rollcall/student-profile/route.ts`
**Discovered:** 2026-07-25
**Threat Level:** 7/10
**Status:** Open — accepted risk (attack requires physical access to classroom QR code; limited to small-business classroom context)

**Description:**
`POST /api/rollcall/session-students` returns all enrolled student names and profile UUIDs with no authentication and no access-code validation server-side. The route comment claims a valid 6-digit instructor code is required, but that gate exists only in the browser UI — the API endpoint itself enforces nothing. `POST /api/rollcall/student-profile` then returns each student's `email`, `phone`, `address`, `city`, `state`, and `zip` with equally no server-side auth. Session UUIDs are not secret: they are embedded in the classroom QR code (`?code=X&session=<uuid>` per `CheckinDisplayClient.tsx:159`) and do not expire after class.

**Attack Vector:**
1. Attacker scans the classroom QR code (or any student's device screen) to capture `?session=<uuid>`.
2. `POST /api/rollcall/session-students` with the UUID → full student roster + profile UUIDs, no credentials required.
3. `POST /api/rollcall/student-profile` with each profileId → email, phone, home address for every enrolled student.

Any student in any class, or any person who walks past the projected QR code, can silently extract the full PII of every classmate.

**Resolution:**
Issue a short-lived signed token (JWT or a UUID stored in a `rollcall_sessions` table) when the instructor successfully verifies the 6-digit code. Require that token on all subsequent rollcall API calls (`session-students`, `student-profile`, `mark-attendance`) and expire it after the class window. Alternatively, require an authenticated Supabase session limited to the `instructor` role.

---

## Medium Severity — Address Before Launch

---

### THREAT-008
**File:** `app/api/sessions/[id]/grades/route.ts` and grading tool page
**Discovered:** 2026-04-21
**Threat Level:** 6/10
**Status:** [N/A — 2026-05-15] No grading API routes exist in the codebase yet. Re-evaluate when the grading tool ships; ownership check must be enforced at that time.

**Description:**
The grading tool is restricted to "Instructor (own) + Super Admin" but the ownership check — confirming the session's `instructor_id` matches the authenticated instructor — is not explicitly specified in the guide for the server-side data fetch or grade save routes.

**Attack Vector:**
Instructor A navigates to `/admin/sessions/[session-b-id]/grades` where the session ID belongs to Instructor B. If the server only checks `role === 'instructor'` without verifying ownership, Instructor A can read all of Instructor B's student grades and submit new grades — including passing students who failed or failing students who passed. This directly affects real AHA certifications.

**Resolution:**
The session data fetch and every grade save operation must verify:
```typescript
if (profile.role === 'instructor' && session.instructor_id !== profile.id) {
  redirect('/admin/sessions')
}
```

---

### THREAT-043
**File:** `app/(public)/book/details/page.tsx`
**Discovered:** 2026-07-14
**Threat Level:** 5/10
**Status:** Open

**Description:**
The `/book/details` step in the booking flow uses the client-side Supabase client (anon key) to check whether an email address is already registered: `supabase.from("profiles").select("id").eq("email", X)`. Because Supabase RLS policies gate rows (not columns), enabling a narrowly scoped duplicate-email check still requires an anon SELECT policy that matches any `profiles` row. The migration `0023_enable_rls.sql` adds this policy with a comment noting it should be tightened.

**Attack Vector:**
A malicious caller with the anon key issues a direct PostgREST GET to `/rest/v1/profiles?select=email,first_name,last_name,...` and enumerates profile data for all registered customers. While they would need to know or guess what to select, the policy does not restrict which columns are readable.

**Resolution:**
Move the duplicate-email check in `app/(public)/book/details/page.tsx` to a server action or API route that uses `createAdminClient()` so the broad anon SELECT policy on `profiles` can be replaced with the narrower `is_lead_instructor = true` policy. The TODO is marked in the migration file.

---

### THREAT-048
**File:** `apps/web/app/api/bookings/confirm-free/route.ts`
**Discovered:** 2026-07-25
**Threat Level:** 5/10
**Status:** Open — accepted risk (requires a publicly distributed promo code AND a victim's customer UUID, which is not publicly exposed; impractical at this scale)

**Description:**
`POST /api/bookings/confirm-free` has no authentication and accepts `customerId` from the request body. Ownership of that customer ID is never verified against any authenticated session. The route uses `createAdminClient()` (service role), bypassing all Supabase RLS policies. The underlying `book_spot` RPC is `SECURITY DEFINER` and performs no identity check.

**Attack Vector:**
An attacker who knows a victim's customer UUID and holds a valid 100%-off promo code (often distributed publicly via email/social media campaigns) POSTs `{ sessionId, customerId: <victim>, promoCode: <valid> }`. The server creates a $0 booking on the victim's account, consumes the promo code, and fills a class seat — all without the victim's knowledge or consent.

**Resolution:**
Add `supabase.auth.getUser()` using a user-scoped client at the top of the handler and assert `user.id === body.customerId`. Return 401 if unauthenticated, 403 if the IDs differ.

---

### THREAT-049
**File:** `apps/web/app/api/bookings/confirm/route.ts`
**Discovered:** 2026-07-25
**Threat Level:** 6/10
**Status:** Open — accepted risk (attacker must spend real money and know victim's UUID; motivation is extremely low at this scale)

**Description:**
`POST /api/bookings/confirm` has no authentication and accepts `customerId` from the request body. PayPal's capture API only verifies the order exists and was buyer-approved — it carries no reference to the app-level `customerId`. The route uses `createAdminClient()`, bypassing all RLS. The booking, payment record, and instructor earning record are all created under the attacker-supplied `customerId`.

**Attack Vector:**
1. Attacker initiates checkout, gets a `paypalOrderId` from the PayPal JS SDK.
2. Attacker approves payment with their own PayPal account (real money spent).
3. Attacker POSTs to `/api/bookings/confirm` with the valid `paypalOrderId` but with a victim's `customerId`.
4. Server captures the payment and creates booking + payment record under the victim's account.
5. The victim's dashboard shows an enrollment they never made; class seat is consumed.

**Resolution:**
Authenticate the caller via `supabase.auth.getUser()` using a user-scoped client, derive `customerId` from the server-side session, and never accept it from the request body. Return 401 if unauthenticated.

---

## Low Severity — Track and Fix When Convenient

---

### THREAT-015
**File:** `app/api/certifications/send-reminders/route.ts`
**Discovered:** 2026-04-21
**Threat Level:** 2/10
**Status:** Open

**Description:**
The cert reminder system queries certifications nearing expiry and sends reminder emails. It does not check whether the customer's account is archived (`profiles.archived = true`).

**Attack Vector:**
A customer requests account deletion (archival). Their account is archived. 60 days later their cert is expiring. The reminder system sends them an email prompting them to renew — from a business they've asked to stop contacting them. Low severity but potentially a GDPR/CAN-SPAM concern depending on jurisdiction.

**Resolution:**
Add to the reminder query: `.eq('profiles.archived', false)`. One line.

---

### THREAT-016
**File:** `app/api/invoices/create/route.ts`
**Discovered:** 2026-04-21
**Threat Level:** 3/10
**Status:** Open

**Description:**
Invoice numbers are generated by counting all existing invoices and incrementing: `INV-${count + 1}`. Two simultaneous invoice creations could both read the same count, generate the same invoice number, and both attempt to insert — one will succeed, one will hit the unique constraint and return a 500 error.

**Attack Vector:**
Two instructors create invoices at the same millisecond (unlikely but possible during busy periods). One receives an error. No money is lost but the instructor must retry. More importantly, a 500 error on invoice creation is a poor experience and could leave a partial state if the platform API call succeeded before the DB insert failed.

**Resolution:**
Use a Postgres sequence for invoice number generation instead of counting:
```sql
create sequence invoice_number_seq start 1;
```
```typescript
const { data } = await supabase.rpc('next_invoice_number')
// Returns: 'INV-00043'
```
Sequences are atomic and collision-proof.

---

### THREAT-017
**File:** `app/api/orders/cancel-refund/route.ts`
**Discovered:** 2026-04-22
**Threat Level:** 3/10
**Status:** Open

**Description:**
When a cancel/refund is processed, the PayPal refund API is called first. If the subsequent Supabase `update` to set `status = 'cancelled'` fails, the customer has been refunded but the order remains `paid` (or `shipped`) in the database. There is no automated alert — only a `console.error` log.

**Attack Vector:**
Not an active exploit by an attacker — this is a system failure path. If the DB update fails due to a transient Supabase error, an admin reviewing the orders page will still see the order as active and may attempt to refund it again, resulting in a double refund. The risk is low exploitability but real monetary impact.

**Resolution:**
Add an `admin_alerts` table or send an internal email via Resend to the owner email whenever this specific failure path is hit. The alert should include the order ID and the refund amount so the owner can manually reconcile. Alternatively, wrap in a Supabase transaction using an RPC that executes the status update and returns the result before the PayPal call — though this is not cleanly possible since PayPal is an external call.

---

### THREAT-020
**File:** `app/(public)/roster/[session_token]/page.tsx` and `_components/RosterCorrectionClient.tsx`
**Discovered:** 2026-04-22
**Threat Level:** 3/10
**Status:** Open

**Description:**
The roster correction page is loaded server-side and passes all student records — including email addresses and phone numbers — to the client component as JavaScript props. These values are therefore visible in the page source to anyone who opens the browser dev tools while viewing the page.

**Attack Vector:**
A student attending the class opens the page, views the HTML source or React component props, and reads the email addresses and phone numbers of their classmates. This is a privacy exposure, not an active exploit — no data can be modified. The URL (`/roster/[session_token]`) is only shared by the instructor in the classroom and is not publicly indexed, which limits the exposed audience to class attendees.

**Resolution:**
Replace the full server-side pass with a server action or thin GET endpoint that returns only the fields needed for the search list (id, firstName, lastName, employer, confirmed, hasDeviceToken). When a student taps their own name, fetch their full record from a separate endpoint (returning full details only if the device token matches or is unset). This prevents bulk exposure of all student contact details in the initial page render.

---

### THREAT-021
**File:** `app/api/roster-upload/submit/route.ts`
**Discovered:** 2026-04-22
**Threat Level:** 5/10
**Status:** Open

**Description:**
Roster files contain PII (employee names, emails, phone numbers). They are stored in S3 using a constructed URL (`https://<bucket>.s3.<region>.amazonaws.com/rosters/<invoiceId>/...`). If the S3 bucket policy grants public read on `rosters/*` (the same bucket used for merch images, which has a public read policy on `merch/*`), these files would be accessible to anyone who can guess or construct the key.

**Attack Vector:**
An attacker who knows the S3 bucket name and an invoice UUID (e.g. from a leaked URL or an internal disclosure) could construct the S3 key and download employee roster data directly — bypassing any application-level access controls.

**Resolution:**
Ensure the bucket policy does NOT grant public read on the `rosters/*` prefix. Confirm this with an explicit Deny statement in the bucket policy. When the admin roster download feature is built, serve files via presigned S3 URLs (short TTL) rather than direct public URLs. A TODO comment is already in the submit route code.

---

### THREAT-022
**File:** `app/api/roster-upload/submit/route.ts`
**Discovered:** 2026-04-22
**Threat Level:** 3/10
**Status:** Open

**Description:**
The roster upload submit endpoint is fully public with no rate limiting. Any caller who obtains a valid `invoiceId` and `sessionId` can upload arbitrary files to S3 repeatedly, consuming storage and generating S3 write costs.

**Attack Vector:**
A caller who finds a valid invoice (e.g. a disgruntled employee or insider) spams the submit endpoint, uploading hundreds of 10MB files. S3 storage costs accumulate; the manager sees dozens of roster submissions for the same invoice.

**Resolution:**
Add rate limiting on this endpoint (e.g. 5 submissions per invoiceId per hour via an in-memory or Redis counter, or using a middleware like next-rate-limit). Low priority before launch given the limited audience for group invoices.

---

### THREAT-023
**File:** `app/api/paypal/create-booking-order/route.ts` and `lib/resolve-payment-routing.ts`
**Discovered:** 2026-04-23
**Threat Level:** 4/10
**Status:** Open

**Description:**
Per-instructor payment routing was implemented for online bookings. The PayPal-Auth-Assertion header directs payment to a specific merchant account ID. If a malicious caller could control `instructorPayPalAccountId`, they could redirect customer payments to an arbitrary PayPal account.

**Attack Vector:**
The `sessionId` is supplied by the client in the booking flow. The routing utility (`resolvePaymentRouting`) reads from `class_sessions.profiles.instructor_payment_accounts` using ONLY the sessionId — the merchant ID is never accepted from the client. So this threat is mitigated by design, but must remain mitigated. Any future change that allows the client to override routing or accept a `instructorPayPalAccountId` from the request body would re-introduce this vulnerability.

**Resolution:**
Mitigated by design — `instructorPayPalAccountId` is always resolved server-side from `sessionId` via the database. Logged here as a permanent reminder: never accept payer_id, merchant_id, or routing overrides from the client.

---

### THREAT-024
**File:** `app/api/settings/instructor-routing/[instructorId]/route.ts`
**Discovered:** 2026-04-23
**Threat Level:** 2/10
**Status:** Open

**Description:**
The PATCH endpoint for instructor payment routing is super_admin-only and validates the routing value against an allowlist (`'instructor'` or `'business'`). The actor's role is checked via the database before the update.

**Attack Vector:**
Low — endpoint is correctly guarded. Logged for visibility because the endpoint controls where money flows and any future regression in the auth check would be high-impact.

**Resolution:**
No action needed at this time. Auth check and value allowlist are both in place. Add this endpoint to any future centralised auth audit checklist.

---

### THREAT-025
**File:** `lib/enrollware-bookmarklet.ts`, `app/api/enrollware/generate-key/route.ts`
**Discovered:** 2026-05-14
**Threat Level:** 3/10
**Status:** Open

**Description:**
The Enrollware bookmarklet API key is embedded directly in the bookmark's JavaScript URL,
which is stored in the browser's bookmark manager. If an instructor shares their bookmarks,
exports them, or syncs them to a shared device, the key is exposed.

**Attack Vector:**
An attacker with access to the instructor's browser bookmarks (e.g. via a shared or stolen
device) could extract the API key from the bookmark URL and use it to query today's class
data and student roster for that instructor. The attacker cannot access other instructors'
data. The key can be revoked and regenerated from the companion admin page at any time.

**Resolution:**
Risk is acceptable for a staff-only tool where instructors control their own devices.
Mitigation in place: keys are scoped per-instructor (cannot access other instructors' data),
stored only as SHA-256 hashes in the DB, and can be revoked instantly by regenerating.
If higher security is needed in future, replace the embedded key with a short-lived token
that the bookmarklet exchanges at runtime via a login popup.

---

### THREAT-040
**File:** `app/api/places/autocomplete/route.ts`, `app/api/places/details/route.ts`
**Discovered:** 2026-05-27
**Threat Level:** 2/10
**Status:** Open (by design — see resolution notes)

**Description:**
The Google Places proxy routes authenticate callers via Supabase session and restrict to `manager` and `super_admin` roles. However, a compromised manager account could use these endpoints to make large numbers of Places API calls, running up costs on the project's Google Cloud billing account.

**Attack Vector:**
A compromised or malicious manager account issues rapid GET requests to `/api/places/autocomplete` in a loop, exhausting the free $200/month credit and generating unexpected Google Cloud charges.

**Resolution:**
Acceptable risk at current usage volumes — this is an internal admin-only tool used by a small number of staff. If abuse becomes a concern, add per-user rate limiting (e.g. 100 requests per hour per user ID) on the proxy routes. Google Cloud also allows setting billing alerts and hard quotas on the Places API key via the Cloud Console.

---

### THREAT-052
**File:** `Building/migrations/0045_revoke_anon_security_definer.sql`, `Building/migrations/0046_revoke_stock_rpc_anon.sql`
**Discovered:** 2026-07-30
**Threat Level:** 7/10
**Status:** FIXED — migration 0049 applied to staging and production (2026-08-03). Verified anon/auth cannot execute any SECURITY DEFINER function in the public schema on either env.

**Description:**
Migrations 0045 and 0046 were written to stop anonymous callers reaching seven
SECURITY DEFINER functions through Supabase's auto-generated REST endpoint
(`/rest/v1/rpc/<name>`). Both used `REVOKE EXECUTE ON FUNCTION ... FROM anon,
authenticated`, which is a no-op: PostgreSQL grants EXECUTE to PUBLIC by default
on every new function, and `anon`/`authenticated` held the privilege through
PUBLIC rather than through any direct grant. Revoking a grant those roles never
individually had changed nothing.

The protection both migrations describe had therefore never been in effect.
Confirmed on staging: `has_function_privilege('anon', oid, 'EXECUTE')` returned
true for `book_spot`, `regenerate_instructor_access_codes`,
`reserve_instructor_payout_batch`, `decrement_stock_if_available`, and
`restore_stock`, with the ACL reading `{=X/postgres,...}` — the leading `=X`
being the PUBLIC grant.

Found while verifying the grants on `reserve_payout_retry_batch`, a new function
added in migration 0048, which had inherited the same flawed pattern.

**Attack Vector:**
An unauthenticated caller with the project's public anon key (which ships in
client-side JavaScript by design) could POST directly to
`/rest/v1/rpc/book_spot` with a session UUID and a profile UUID. Session UUIDs
are already exposed in the public booking flow, and an attacker can register to
obtain their own profile UUID. `book_spot` has no internal authorisation check —
it only verifies capacity — so this creates confirmed bookings that bypass the
PayPal payment flow entirely: free seats, and class capacity exhausted against
paying customers.

The others are lower impact but real: `regenerate_instructor_access_codes` would
reset every instructor's access code; the payout reservation functions do check
`p_actor_id` is an active super_admin internally, but a caller who obtained a
super_admin profile UUID (potentially exposed through published staff bios) could
repeatedly lock all pending earnings into reserved batches, stalling payouts and
disclosing instructor PayPal payout emails in the RPC's return value; the stock
functions could manipulate merch inventory counts outside checkout.

**Resolution:**
Migration 0049 revokes EXECUTE from PUBLIC on all seven functions and re-asserts
the `service_role` grant that the server-side routes depend on, so every route
using `createAdminClient()` is unaffected. Verified after applying: `anon_exec`
and `auth_exec` are both false for every SECURITY DEFINER function in the public
schema, `service_exec` remains true.

The migration is driven by a `pg_proc` lookup rather than hard-coded signatures,
because the function set differs between environments — `mark_invoice_paid` is
absent from staging entirely — and a missing function must not abort the
migration.

**Follow-up required:** migration 0049 must be applied to production. Until it
is, production remains exposed. Any future SECURITY DEFINER function in the
public schema needs `REVOKE EXECUTE ON FUNCTION <name>(<args>) FROM PUBLIC` in
its own migration; revoking from anon/authenticated alone does nothing. Audit
query is documented at the bottom of 0049.

---

## THREAT-053 — Rate-limit abuse on /api/paypal/client-token

**Severity:** 2/10 (low)
**File:** `apps/web/app/api/paypal/client-token/route.ts`
**Date:** 2026-07-30

**Description:** The endpoint generates a PayPal Identity token on every GET request with no authentication or rate limit. A burst of requests from a single IP could consume PayPal's Identity API rate limit for the business account.

**Mitigations in place:** PayPal's Identity API limits are generous (hundreds of req/min); the token has a ~1hr TTL so legitimate page loads are infrequent; no sensitive data is exposed.

**Recommended follow-up:** Add basic IP-level rate limiting (e.g., via Next.js middleware or a CDN rule) if abuse is observed in logs.

---

## THREAT-054 — Declined card payments created confirmed bookings, phantom revenue, and instructor payout liability

**Severity:** 9/10 (high)
**Files:** `apps/web/app/api/bookings/confirm/route.ts`, `apps/web/app/api/orders/confirm/route.ts`
**Date:** 2026-07-30
**Status:** FIXED (code). Bad staging records still require cleanup — see below.

**Description:** Both checkout routes captured a PayPal order and then treated
any HTTP 2xx response as a successful payment. PayPal returns **HTTP 201 for a
declined card** and signals the decline only in
`purchase_units[].payments.captures[].status`. Neither route ever read that
field.

Worse, a DECLINED capture still returns a fully populated
`seller_receivable_breakdown` (gross/fee/net) and an `amount.value` matching the
order total, so the existing amount-match check passed too. The declined payment
therefore flowed straight through to:

- `book_spot` — a real seat reserved for an unpaid customer
- `payments` row inserted with `status: 'completed'` and real-looking fee/net figures
- `instructor_earnings` row accruing a genuine payout liability
- `maybeTriggerImmediatePayout` invoked
- Booking confirmation email sent to the customer

**Attack vector:** Zero skill required. Anyone can check out with a card known to
decline (insufficient funds, closed account) and receive a confirmed seat plus a
confirmation email. Repeated at scale this both gives away inventory and inflates
instructor payout liabilities that the business would settle out of pocket for
money it never received. The identical flaw existed in merch checkout.

**Confirmed real-world occurrence:** live capture `99434303YL747080U`
(staging DB, $55.00) — PayPal reports `status: DECLINED`,
`response_code: 9100`, `payment_advice_code: 02`, yet the system recorded
`net_amount: 53.12` as profit and accrued $44.00 owed to the instructor.

**Fix:** Added `evaluateCaptureOutcome()` to `lib/paypal.ts` as the single
source of truth for whether a capture settled. It returns `settled: true` only
when `capture.status === "COMPLETED"`; DECLINED / PENDING / FAILED / REFUNDED /
PARTIALLY_REFUNDED / missing-status / missing-capture all return `settled:
false`. Both routes now reject with HTTP 402 before creating any booking,
payment, earning, payout, or email. No refund is attempted on a declined
capture (there are no funds to return). Regression tests added in
`tests/unit/lib/paypal-capture-outcome.test.ts` and
`tests/unit/api/bookings-confirm.test.ts`, including assertions that `book_spot`
and `recordBookingEarning` are never called on a decline.

**Follow-up required:**
1. Reverse the bad staging records for capture `99434303YL747080U`
   (payment `f5ebfe68-3982-4e81-bdbb-aa736c8f1b92`,
   booking `cca139da-6f67-42f7-8ab2-592d19b82316`,
   earning `95bf587c-1eae-4a62-a98d-62a6ef3250ea`). No payout batch/item/attempt
   was ever created, so no real money left the account.
2. Audit production `payments` for any `completed` row whose PayPal capture is
   not actually COMPLETED, using the same `/v2/payments/captures/{id}` lookup.
3. Consider subscribing to the `PAYMENT.CAPTURE.DECLINED` and
   `PAYMENT.CAPTURE.COMPLETED` webhooks so a late status change is reconciled
   rather than silently diverging. A `PENDING` capture is currently rejected
   outright (TODO noted in the route).

**Production audit result (2026-07-30):** Production contains only 4 online
payment rows, all `completed`, totalling $10.00 (test amounts). Verified each
against `/v2/payments/captures/{id}`:

| Capture | Amount | PayPal status |
|---|---|---|
| 1RB24628GA517652M | $1.00 | COMPLETED |
| 0W635693YT723121V | $7.00 | COMPLETED |
| 0YM48549YJ175420W | $1.00 | COMPLETED |
| 8HV47329S97979446 | $1.00 | Unverifiable — NOT_AUTHORIZED / PERMISSION_DENIED |

The unverifiable capture is not evidence of a decline; the live business
credentials simply cannot see it (most likely a sandbox-era transaction ID from
before `PAYPAL_API_BASE` was switched to live). Its instructor earning is
`instructor_amount: 0.00`, status `pending`, with no payout batch — so worst-case
exposure is $1.00 gross and $0.00 owed. **No declined-but-confirmed payment
exists in production.** Follow-up item 2 is therefore closed.

**Follow-on fix (2026-08-03):** The deterministic PayPal-Request-Id in both
create-order routes (`bk-sha256(session:amount:addons)` and
`manual-charge-sha256(session:amount:description)`) made every retry after a
declined capture — and any same-priced manual charge for a second customer —
reuse the original PayPal order. PayPal marks an order COMPLETED after ANY
capture attempt (verified live: order 80X53287KW104315K is COMPLETED with only
a DECLINED capture), so retries hit a consumed order and the JS SDK fails with
the unrecoverable `ERR_DEV_RECEIVED_CLIENT_ERROR_RESPONSE`, bricking the
"declined → try another card" path that THREAT-054's fix directs buyers to.
Both routes now use `randomUUID()` per attempt; verified two identical requests
produce distinct fresh orders. Abandoned CREATED orders expire harmlessly.

---

## THREAT-055 — Manual charge recorded client-claimed amount instead of PayPal's captured amount

**Severity:** 5/10 (medium)
**File:** `apps/web/app/api/paypal/capture-manual-charge/route.ts`
**Date:** 2026-08-03
**Status:** FIXED

**Description:** The route captured a PayPal order, then wrote the CLIENT-supplied
`amount` into `payments.amount` and `instructor_earnings.gross_amount` without
comparing it to what PayPal actually captured. A manager-level user could create
an order for $1, capture it, and POST `amount: 100` — recording $100 of phantom
revenue and crediting the instructor a payout on money that never arrived
(the platform would then pay out real dollars against it). Requires a manager or
super_admin account, so exposure is insider misuse or a compromised staff account.

**Fix:** The route now rejects with 409 when PayPal's captured amount differs from
the submitted amount by more than $0.01, and records `outcome.capturedAmount`
(PayPal's figure) rather than the client's in both the payment row and the
instructor earning.

---

## THREAT-056 — Production runs code writing payments columns that don't exist in the production DB

**Severity:** 8/10 (high) — availability/data-integrity, not attacker-driven
**Files:** deployed `main` (`app/api/bookings/confirm/route.ts`, `capture-manual-charge`, payout routes) vs production Supabase schema
**Date:** 2026-08-03
**Status:** FIXED (verified 2026-08-04)

**Description:** Production Amplify deployed commit 7b0d3fb (2026-08-01 05:18 ET),
which inserts `paypal_fee_amount` / `net_amount` into `payments` and depends on
the payout-tracking tables from migration 0048. Production Supabase is at
migration 0047 — those columns/tables do not exist (verified: the audit query
against production failed with `column "paypal_fee_amount" does not exist`, and
list_migrations shows staging at 0049, production at 0047).

**Consequence:** The next real online booking on superherocpr.com will charge the
customer and create the booking, but the payments insert fails (logged CRITICAL,
response still success) — no payment record, no instructor earning payment link.
Manual charges and payout operations fail similarly. Verified zero bookings have
occurred since the Aug 1 deploy, so no damage yet — but every day this stands is
a coin flip on a real customer hitting it.

**Fix:** Migrations 0048_payout_tracking and 0049_revoke_public_execute_security_definer
were applied to production on 2026-08-03. Re-verified via `list_migrations` on
2026-08-04: both staging and production show identical history through 0049.
The THREAT-052 RPC exposure closed by 0049 is also resolved in production.

---

## THREAT-057 — Team signup share token is a bearer credential exposing attendee names

**Severity:** 3/10 (low) — accepted by design
**Files:** `app/(public)/team/[share_token]/page.tsx`, `app/api/team-bookings/[share_token]/route.ts`, `lib/team-bookings.ts`
**Date:** 2026-08-17
**Status:** ACCEPTED (mitigated)

**Description:** The team-booking signup link is authorised solely by an
unguessable `team_bookings.share_token` (UUID v4) in the URL. Anyone holding the
link can view the class details and the list of people signed up, and can take a
seat in the class. The company contact forwards this link freely to their own
staff, so it will inevitably spread beyond a controlled list, and forwarded
emails/chat logs preserve it indefinitely.

**Why accepted:** This is the same trust model already accepted for
`/roster/[session_token]` and `/submit-roster?invoice=`, and it is the explicit
product requirement — the customer distributes the link themselves to whoever
they want to attend, and they are the ones paying. Requiring per-employee
invitations would defeat the purpose of the feature.

**Mitigations in place:**
- The attendee list returns **first and last name only** — never emails, phone
  numbers, or profile ids. `getTeamBookingByShareToken()` constructs the
  `TeamAttendee` objects explicitly rather than passing joined rows through, and
  a unit test asserts no email address appears anywhere in the payload.
- Seats are still bounded by the session's `max_capacity` via `book_spot`, so a
  leaked link cannot cost the company more than the class they already booked.
- An employee must create or sign into a real account to take a seat, so every
  booking is attributable to a named person.
- Invalid and non-existent tokens return an identical response, so the endpoint
  cannot be used to probe for valid links.
- The page sets `robots: { index: false, follow: false }` so links that leak into
  crawlable places are not indexed.

---

## THREAT-058 — Team per-seat price must never be sourced from the client

**Severity:** 4/10 (medium) — closed at implementation time
**Files:** `app/api/team-bookings/[share_token]/signup/route.ts`, `app/api/paypal/create-booking-order/route.ts`, `app/api/promo-codes/validate/route.ts`, `lib/session-pricing.ts`
**Date:** 2026-08-17
**Status:** FIXED

**Description:** Team bookings introduce a negotiated per-seat rate that
overrides the catalog price. If that rate were accepted from the request body,
a buyer could name their own price — the THREAT-013 class of bug, but with a
new input path that bypasses `getSessionPricing()`'s usual catalog lookup.

**Fix:** `getSessionPricing()` gained a `teamPricePerSeat` option, and every
route that uses it resolves the value by calling `getTeamBookingByShareToken()`
with the URL token and reading `price_per_seat` from the DB. The client sends
only the opaque token, never a price. The signup route additionally re-derives
the expected total server-side and rejects (409) when the client-submitted
`amount` differs by more than $0.01, then verifies PayPal's actual captured
amount against the same figure before the booking is created — identical
ordering to `/api/bookings/confirm`.

The order-creation and promo-validation routes take the same token so all three
price against the same basis; without that, a promo-coded team signup would be
quoted against the catalog price and then rejected as a mismatch at capture.

---

## THREAT-059 — Team invoices would double-count class headcount

**Severity:** 5/10 (medium) — data integrity, not attacker-driven
**Files:** `apps/migrations/0055_team_bookings.sql`, `lib/team-bookings.ts`
**Date:** 2026-08-17
**Status:** FIXED

**Description:** `mark_invoice_paid` (migration 0016) inserts one anonymous
`bookings` row per `invoices.student_count` when an invoice is marked paid,
because the classic group-invoice flow has no real attendee records. A team
booking is the opposite: named employee bookings are created as people sign up
through the link, typically **before** the company's invoice clears. Left
unchanged, marking a team invoice paid would have inserted a second full set of
placeholder seats — doubling the headcount, potentially pushing the session over
`max_capacity`, and corrupting the roster the instructor teaches from.

A second instance of the same problem: `book_spot` counts
`sum(student_count) from invoices where status not in ('cancelled','paid')`
toward capacity, so an unpaid team invoice carrying a real headcount would have
blocked the very employees it was raised for.

**Fix:** Migration 0055 redefines `mark_invoice_paid` to skip the
placeholder-booking insert when a `team_bookings` row references the invoice.
Team invoices are additionally written with `student_count = 0` so they consume
no capacity while unpaid; the PayPal line item is supplied separately as a flat
quantity-1 charge via the new `primaryLineItem` option on `createAndSendInvoice()`.
The guard is the primary protection and does not depend on that value being 0.

---

## THREAT-060 — Unauthenticated confirm route could flood the payments table

**Severity:** 4/10 (medium) — availability/data-quality, no data or funds exposed
**Files:** `apps/web/app/api/bookings/confirm/route.ts`, `apps/web/lib/payment-failures.ts`
**Date:** 2026-08-18
**Status:** MITIGATED

**Description:** `/api/bookings/confirm` is unauthenticated by design — the
PayPal order id is the verification. Adding failed-payment logging to it
introduced a write primitive reachable without credentials: a script holding a
real `customerId` and `sessionId` (both UUIDs that appear in normal client
traffic) could post fabricated `paypalOrderId` values in a loop. Each one fails
the PayPal capture and, unguarded, would have written a `payments` row with
status `failed`. That bloats the table and — more damagingly — buries genuine
customer declines under noise on `/admin/payments`, defeating the purpose of
the feature.

**Fix:** `isLoggableCaptureFailure()` skips the insert for capture issues that
mean no real payment attempt occurred: `RESOURCE_NOT_FOUND`,
`INVALID_RESOURCE_ID`, `ORDER_NOT_APPROVED`, `ORDER_ALREADY_CAPTURED`. A
fabricated order id always lands in that set, while a genuine decline requires
a real PayPal order the caller had to create and submit a card against first —
which is not free to generate at volume. Unparseable errors are still logged so
real server-side anomalies stay visible.

---

## THREAT-061 — New cron_job_expectations table shipped without RLS

**Severity:** 6/10 (medium) — unauthenticated write primitive against a
monitoring control table; no PII, funds, or accounts exposed
**Files:** `apps/migrations/0057_cron_heartbeat.sql`
**Date:** 2026-08-19
**Status:** FIXED (same day)

**Description:** Migration 0057 created two tables. `cron_run_log` got
`enable row level security`; `cron_job_expectations` did not.

Supabase grants `anon` and `authenticated` full DML — SELECT, INSERT, UPDATE,
DELETE, TRUNCATE — on every table in the `public` schema by default. RLS is the
only thing that makes those grants inert. Verified on production before the fix:

```
cron_job_expectations | anon | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
cron_job_expectations | rls_enabled = false
```

Every other table in the schema (`payments`, `team_bookings`, `cron_run_log`)
carries the same grants but has RLS on, so they are protected. This one was
reachable through PostgREST with the public anon key.

**Attack vector:** `PATCH /rest/v1/cron_job_expectations` with the anon key,
setting `max_gap_minutes` to a very large value on every row. `cron_health()`
would then never report any job overdue, silently disabling the entire
scheduled-job monitoring system added in the same migration — including the
heartbeat on `alert-stuck-payout-batches`, a financial safety net. Deleting rows
is less damaging (the function falls back to a 1500-minute default), and
inserting junk rows is inert because the job list is derived from `cron.job`.

**Fix:** `alter table public.cron_job_expectations enable row level security;`
applied to production and staging, and added to 0057 so a replay cannot
reintroduce it. No policies are defined, which denies anon and authenticated
entirely; `service_role` bypasses RLS and is the only intended caller.

**Lesson:** the Supabase advisor caught this within an hour of the table being
created, as an ERROR-level `rls_disabled_in_public`. Adding an advisor check to
the recurring maintenance schedule (§8 of the overhaul checklist) is what turns
that from luck into process. A new table is not finished until RLS is on it.
