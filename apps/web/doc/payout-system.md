# Payout System — How It Works

A technical and plain-English walkthrough of the full instructor payout flow,
from saving a PayPal email to money arriving in an instructor's account — and
what happens when PayPal decides otherwise after the fact.

---

## The one thing to understand first

**PayPal accepting a payout batch is not PayPal delivering it.**

When the app calls the Payouts API, a `201` with `batch_status: PENDING` means
PayPal accepted the *instruction*. Funding and risk checks happen asynchronously
afterwards. PayPal can deny the batch hours later — risk review, insufficient
available balance, an account limitation — and return the money to the business
account. The API response gives no warning, and the denial reason appears only in
PayPal's dashboard and notification email.

Everything below is shaped around that fact. A submitted batch is recorded as
**assumed complete**, never "paid", until PayPal confirms it.

---

## Step 1 — Instructor saves their PayPal email

**Page:** `/admin/profile/payment`
**Code:** `PayoutSettingsClient.tsx` → `PATCH /api/profile/payout-email`

The instructor types their PayPal email into a form and hits Save. The API validates
it is a real email format, then writes it to `profiles.paypal_payout_email`. That is
all — no PayPal OAuth, no account linking, just a plain email address.

**Plain English:** The instructor tells the system "send money here." Nothing else happens yet.

---

## Step 2 — A customer pays for a class or invoice

**Code:** `POST /api/bookings/confirm` or `POST /api/invoices/[id]/mark-paid`

When a customer completes a PayPal payment, all the money goes to **SuperHeroCPR's**
business PayPal account. The app then immediately calls either `recordBookingEarning()`
or `recordInvoiceEarning()` in `lib/instructor-earnings.ts`.

That function:
1. Reads `platform_fee_percent` from `system_settings` (default: 20%)
2. Calculates the split — e.g. $100 class → $20 to SuperHeroCPR, $80 to the instructor
3. Inserts a row into `instructor_earnings` with `status = 'pending'`

For booking payments the route also reads `seller_receivable_breakdown` off the
PayPal capture response and stores the **real** processing fee on the `payments`
row (`paypal_fee_amount`, `net_amount`). This costs no extra API call and is the
only exact source for what a payment cost.

A `NULL` fee means **not tracked**, never zero. PayPal-invoice payments and
manually logged cash/check payments do not report a fee, so their rows stay null
and the dashboard says so rather than implying the money was free to collect.

**Plain English:** SuperHeroCPR collects all the money first, then records an IOU to
the instructor in the database, along with what PayPal charged to collect it.

---

## Step 3 — Payout is triggered (3 possible modes)

Configured in Admin Settings → Payouts tab (`system_settings.payout_trigger`):

| Mode | How it fires |
|---|---|
| **Immediate** | Right after every booking/invoice payment, `lib/payout-trigger.ts` fires a non-blocking background fetch to `POST /api/payouts/create` |
| **Scheduled** | A `pg_cron` database job (migration 0021) calls `POST /api/payouts/create` on a daily/weekly/monthly schedule |
| **Manual** | A super_admin clicks "Send Payouts" on `/admin/payouts` or in Settings → Payouts |

All three paths hit the same route. The trigger mode only controls *when* it is called.

**Cost note:** PayPal's payout fee is charged **per recipient item** (US domestic:
2%, capped at $1). Batching an instructor's earnings into one item pays that cap
once; Immediate mode creates a separate batch per transaction and pays it per
booking. The Settings → Payouts tab quantifies the difference for whatever is
currently queued.

---

## Step 4 — Atomic batch reservation

**Code:** `POST /api/payouts/create` → calls SQL RPC `reserve_instructor_payout_batch`

This is a single PostgreSQL function that does everything atomically using
`FOR UPDATE SKIP LOCKED` to prevent double-paying:

1. Finds all `instructor_earnings` rows where:
   - `status = 'pending'`
   - `instructor_amount > 0`
   - The instructor has a `paypal_payout_email` saved and is not archived or deactivated
2. Groups by instructor, sums their amounts
3. Creates one `instructor_payout_batches` row (a batch header)
4. Creates one `instructor_payout_items` row per instructor (one line per person to pay)
5. Updates every matched `instructor_earnings` row to `status = 'payout_pending'`
6. Writes one `instructor_payout_attempts` row per earning (migration 0048)

If there are no eligible earnings, the RPC returns early with `no_eligible_earnings`.

**Why the attempts table exists:** reconciliation clears
`instructor_earnings.payout_batch_id` when an attempt fails. That used to destroy
the only record of which earnings were in a denied batch, making a targeted retry
impossible. Attempt rows keep that link permanently and give each earning a
readable history.

---

## Step 5 — PayPal Payouts API call

**Code:** `app/api/payouts/create/route.ts` → `submitReservedPayout()` in `lib/payout-submit.ts`

Shared with the retry route so both submit identically. On success the batch
becomes **`assumed_complete`** with the PayPal batch id stored.

Failure recovery depends on what PayPal said:

| Situation | What happens |
|---|---|
| Clear 4xx rejection (not 409) — nothing was created | `releaseFailedReservation()` — earnings return to `pending`, batch/items `failed`, attempts `failed` |
| Outcome unknown (network died mid-request) | `holdUncertainReservation()` — batch/items `needs_review`, earnings stay locked. **Never** retried automatically: the money may already be in flight |

---

## Step 6 — Reconciliation

**Code:** `lib/payout-reconcile.ts`, called by three routes

| Caller | When |
|---|---|
| `POST /api/payouts/sync` | Admin clicks "Sync status", **and** an hourly `pg_cron` job (migration 0048) |
| `POST /api/webhooks/paypal-payouts` | PayPal pushes a batch or item event as it happens |
| `POST /api/payouts/deny` | An admin records a denial manually |

All three go through the same code so they can never disagree about what a PayPal
status means. Every webhook event triggers a full re-read of the batch from PayPal
rather than trusting the event payload, which makes duplicate and out-of-order
deliveries harmless.

### Status mapping

| PayPal `transaction_status` | Local item status | Earnings released? |
|---|---|---|
| SUCCESS | `completed` → earnings `paid` | No |
| PENDING / PROCESSING / ONHOLD / HELD | `assumed_complete` | No |
| UNCLAIMED | `unclaimed` (+ 30-day expiry recorded) | **No** — PayPal still holds the money |
| DENIED / BLOCKED / RETURNED / REFUNDED / REVERSED / CANCELED | `denied` | Yes → back to `pending` |
| FAILED | `failed` | Yes → back to `pending` |
| anything unrecognised | `assumed_complete` | No — safe default |

`UNCLAIMED` having its own status matters: PayPal holds those funds for 30 days
before returning them. Releasing the earnings at that point would send the same
money twice.

### The empty denied batch

PayPal can report a batch header of `DENIED` with **no item array at all**. A
denied header now releases every item's earnings regardless of what the item array
contains. Previously this produced zero failed items, the batch was recorded as
`completed` with a timestamp, and completed batches were excluded from future
syncs — silently burying the denial and leaving the earnings stuck forever.

---

## Batch and item statuses

| Status | Meaning | Retryable? |
|---|---|---|
| `pending` | Reserved in the DB, nothing sent yet | Use Release |
| `assumed_complete` | PayPal accepted it; delivery presumed, not confirmed | Mark denied first |
| `completed` | Delivery confirmed by sync or webhook | Mark denied first |
| `denied` | PayPal refused after accepting; funds returned | **Yes** |
| `failed` | Never left the app | **Yes** |
| `needs_review` | Outcome genuinely unknown | **Not resendable** — confirm in PayPal, then Release (if nothing was created) or Mark denied |
| `unclaimed` (items only) | Held 30 days for a recipient with no PayPal account | No |

---

## Recording a denial

**Code:** `POST /api/payouts/deny`

Marking a delivered payout as denied is the one action here that can pay an
instructor twice with no way to recover the money, so it is deliberately hard to
misuse:

1. **PayPal is asked first.** If PayPal reports the payout succeeded, the request
   is refused with a 409.
2. **If PayPal itself reports the denial**, the route reconciles from PayPal's own
   data instead of recording the admin's assertion.
3. **Typed confirmation** — the batch's `sender_batch_id` must be typed back.
4. **Full audit** — `denied_at`, `denied_by`, `denial_source`
   (`manual` / `paypal_sync` / `webhook`), and `denial_reason` are all stored.

Scope can be a whole batch or a single item. **Single item is usually correct**:
one instructor's bad email should not re-pay everyone else in the batch.

---

## Resending

**Code:** `POST /api/payouts/retry` → RPC `reserve_payout_retry_batch`

Builds a **new** batch from exactly the source batch's earnings, linked via
`retry_of_batch_id`, with a fresh `sender_batch_id` (PayPal rejects a reused one as
a duplicate). Recipient emails are re-read from `profiles`, not copied — a denial
caused by a bad address is fixed by the instructor updating it.

The RPC refuses a partial retry and returns a reason instead:

| Reason | Meaning |
|---|---|
| `source_batch_not_retryable` | Status is not `denied` or `failed` |
| `no_attempt_history` | Batch predates migration 0048 |
| `earnings_changed` | Some earnings were already paid, swept into a newer batch, or became unpayable |
| `earnings_locked` | A concurrent payout holds row locks |

Refusing strands nothing: earnings released by a denial are back to `pending`, so
the normal "Send Payouts" flow still collects them.

---

## Notifications

| Email | To | When |
|---|---|---|
| `payoutDeniedAdminEmail` | All active super_admins | A batch is found denied by sync or webhook |
| `instructorPayoutSentEmail` | The instructor | PayPal **confirms** their payout was delivered |

The instructor email only fires on confirmed delivery and only once per item, so
nobody is told they were paid for a batch that was later denied.

---

## Environment setup

| Variable | Purpose |
|---|---|
| `PAYPAL_PAYOUTS_WEBHOOK_ID` | Webhook subscription ID for the payouts webhook. **Separate** from `PAYPAL_INVOICE_WEBHOOK_ID` — each PayPal subscription has its own ID and target URL |
| `CRON_SECRET` | Bearer token for the `pg_cron` payout-create and payout-sync jobs |

**Webhook setup, per environment (sandbox and live are separate):** PayPal
dashboard → Apps & Credentials → your REST app → Webhooks → Add. Point it at
`/api/webhooks/paypal-payouts` and subscribe to:

```
PAYMENT.PAYOUTSBATCH.DENIED / .SUCCESS / .PROCESSING
PAYMENT.PAYOUTS-ITEM.SUCCEEDED / .DENIED / .BLOCKED / .FAILED
PAYMENT.PAYOUTS-ITEM.RETURNED / .UNCLAIMED / .REFUNDED / .CANCELED / .HELD
```

Until the webhook ID is set, the route is inert and reconciliation relies on the
hourly cron alone — slower, but still correct.

---

## Data flow summary

```
Customer pays
    ↓
All $ → SuperHeroCPR PayPal   (real processing fee stored on payments)
    ↓
instructor_earnings row inserted (status: pending)
    ↓
Trigger fires (immediate / scheduled / manual)
    ↓
reserve_instructor_payout_batch RPC (atomic lock)
    → instructor_payout_batches (1 row)
    → instructor_payout_items (1 row per instructor)
    → instructor_payout_attempts (1 row per earning)
    → instructor_earnings → status: payout_pending
    ↓
PayPal Payouts API called
    → batch → status: assumed_complete       ← NOT "paid"
    ↓
Reconciliation (hourly cron / webhook / admin sync / manual denial)
    → SUCCESS:   earnings → paid, instructor emailed
    → UNCLAIMED: held 30 days, expiry recorded, earnings stay locked
    → DENIED:    earnings → pending, super_admins emailed, batch resendable
    → unknown:   needs_review, earnings stay locked for human review
```

---

## Not in scope

**Refunded bookings do not reverse instructor earnings.** Nothing sets
`instructor_earnings.status = 'cancelled'`. This is deliberate — refunds are
handled as a separate business process and do not change what the instructor is
owed.

**Class assistants have no payout path.** The unique index on
`instructor_earnings.booking_id` means one booking produces exactly one earning,
so assistants are documentation-only, as the assistant email states.

---

## Key files

| File | Role |
|---|---|
| `app/(admin)/admin/profile/payment/_components/PayoutSettingsClient.tsx` | Instructor payout email form |
| `app/api/profile/payout-email/route.ts` | Saves `profiles.paypal_payout_email` |
| `lib/instructor-earnings.ts` | Calculates and records earnings after payment |
| `lib/payout-trigger.ts` | Fires immediate payout after booking/invoice |
| `lib/payout-submit.ts` | Shared PayPal submission + failure recovery |
| `lib/payout-reconcile.ts` | Shared PayPal status interpretation and write-back |
| `lib/payout-notify.ts` | Denial alerts and instructor payout emails |
| `lib/payout-fees.ts` | Fee estimation, break-even, batching cost comparison |
| `lib/payout-dashboard.ts` | Server-side data assembly for both admin panels |
| `app/api/payouts/create/route.ts` | Reserves a batch and submits it |
| `app/api/payouts/sync/route.ts` | Reconciles against PayPal (admin + hourly cron) |
| `app/api/payouts/deny/route.ts` | Records a denial, with the PayPal pre-check |
| `app/api/payouts/retry/route.ts` | Resends a denied/failed batch as a linked batch |
| `app/api/payouts/release/route.ts` | Unblocks a `failed` or `needs_review` batch that never reached PayPal |
| `app/api/webhooks/paypal-payouts/route.ts` | PayPal push notifications for payouts |
| `app/(admin)/_components/UpcomingPayoutsPanel.tsx` | Shared upcoming-payouts panel |
| `app/(admin)/_components/PayoutHistoryPanel.tsx` | Shared history panel with deny/resend |
| `app/(admin)/admin/payouts/page.tsx` | Admin payout dashboard |
| `app/api/settings/payouts/route.ts` | Reads/writes payout trigger and schedule settings |
| `Building/migrations/0020_instructor_payouts.sql` | Tables, constraints, reservation RPC |
| `Building/migrations/0021_payout_settings.sql` | Payout schedule settings + pg_cron job |
| `Building/migrations/0048_payout_tracking.sql` | Fees, status model, denials, retries, attempts, hourly sync cron |
