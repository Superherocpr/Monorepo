# Payout System — How It Works

A technical and plain-English walkthrough of the full instructor payout flow,
from saving a PayPal email to money arriving in an instructor's account.

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

**Plain English:** SuperHeroCPR collects all the money first, then records an IOU to
the instructor in the database.

---

## Step 3 — Payout is triggered (3 possible modes)

Configured in Admin Settings → Payouts tab (`system_settings.payout_trigger`):

| Mode | How it fires |
|---|---|
| **Immediate** | Right after every booking/invoice payment, `lib/payout-trigger.ts` fires a non-blocking background fetch to `POST /api/payouts/create` |
| **Scheduled** | A `pg_cron` database job (migration 0021) calls `POST /api/payouts/create` on a daily/weekly/monthly schedule |
| **Manual** | A super_admin clicks "Send Payouts" on `/admin/payouts` |

All three paths hit the same route. The trigger mode only controls *when* it is called.

**Plain English:** The system has three gears — pay out instantly after every class,
pay out on a schedule, or let a human decide when to send it.

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

If there are no eligible earnings, the RPC returns early with `no_eligible_earnings`.

**Plain English:** The database atomically "locks in" who gets paid and how much, so a
second click or a second cron job cannot accidentally pay the same person twice.

---

## Step 5 — PayPal Payouts API call

**Code:** `app/api/payouts/create/route.ts` → `createPayPalPayoutBatch()`

The reserved items are sent to PayPal's Payouts API. PayPal returns a `payoutBatchId`.
The app stores that ID on the `instructor_payout_batches` row and updates
`status = 'submitted'`.

At this point the money is *in flight* — PayPal is processing it, but it has not yet
landed in anyone's account.

**Plain English:** The app tells PayPal "pay these people these amounts" and saves the
tracking number PayPal gives back.

---

## Step 6 — Reconciliation (sync)

**Code:** `POST /api/payouts/sync` — triggered by admin clicking "Sync status" on `/admin/payouts`

The app asks PayPal for the status of each submitted batch. For each payout item:

- **SUCCESS** → `instructor_earnings.status = 'paid'`, `payout_item.status = 'completed'`
- **FAILED / RETURNED / BLOCKED / etc.** → earnings reset to `status = 'pending'` (will
  be included in the next batch), payout item marked `failed`

**Plain English:** This is the "check if the money actually arrived" step. If someone's
PayPal address was wrong or their account was blocked, their earnings go back into the
queue automatically.

---

## Error handling edge cases

| Scenario | What happens |
|---|---|
| PayPal rejects the batch entirely (before sending) | `releaseFailedReservation()` — all earnings reset to `pending`, batch marked `failed` |
| Network error *after* calling PayPal (result unknown) | `holdUncertainReservation()` — batch flagged for human review, earnings stay locked to prevent double payment |
| Instructor has no payout email | Earnings stay `pending` indefinitely; instructor is listed on `/admin/payouts` as missing payout setup |

---

## Data flow summary

```
Customer pays
    ↓
All $ → SuperHeroCPR PayPal
    ↓
instructor_earnings row inserted (status: pending)
    ↓
Trigger fires (immediate / scheduled / manual)
    ↓
reserve_instructor_payout_batch RPC (atomic lock)
    → instructor_payout_batches (1 row)
    → instructor_payout_items (1 row per instructor)
    → instructor_earnings → status: payout_pending
    ↓
PayPal Payouts API called
    → instructor_payout_batches → status: submitted
    ↓
Admin syncs status
    → SUCCESS: instructor_earnings → status: paid
    → FAILED:  instructor_earnings → status: pending (retry next batch)
```

---

## Key files

| File | Role |
|---|---|
| `app/(admin)/admin/profile/payment/_components/PayoutSettingsClient.tsx` | Instructor payout email form |
| `app/api/profile/payout-email/route.ts` | Saves `profiles.paypal_payout_email` |
| `lib/instructor-earnings.ts` | Calculates and records earnings after payment |
| `lib/payout-trigger.ts` | Fires immediate payout after booking/invoice |
| `app/api/payouts/create/route.ts` | Reserves batch and calls PayPal Payouts API |
| `app/api/payouts/sync/route.ts` | Reconciles PayPal status back to local DB |
| `app/api/payouts/release/route.ts` | Admin tool to manually unblock stuck earnings |
| `app/(admin)/admin/payouts/page.tsx` | Admin payout dashboard |
| `app/api/settings/payouts/route.ts` | Reads/writes payout trigger and schedule settings |
| `Building/migrations/0020_instructor_payouts.sql` | DB schema: tables, constraints, RPC |
| `Building/migrations/0021_payout_settings.sql` | DB schema: payout schedule settings + pg_cron job |
