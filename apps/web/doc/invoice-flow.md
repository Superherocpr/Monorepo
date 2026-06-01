# Invoice Flow — How It Works

A technical and plain-English walkthrough of the full invoice lifecycle,
from an instructor creating one to the money being recorded as a payout.

---

## Overview

Invoices are used when a company, school, or group pays for a block of seats
rather than booking individually online. An instructor sends a PayPal invoice
to the contact, that person pays it on PayPal, and the instructor manually
marks it paid in the app to confirm the seats.

---

## Step 1 — Instructor creates an invoice

**Page:** `/admin/invoices/new`  
**Code:** `POST /api/invoices/create`

The instructor fills out the form with:
- Recipient name and email
- Which class session the invoice is for
- Number of students
- An optional note

When they hit "Send Invoice", the API:

1. **Validates** the request — required fields, sane student count
2. **Re-checks spot availability** at the moment of submit to prevent overbooking
   (spots are not reserved yet at this stage)
3. **Creates a PayPal invoice** from the SuperHeroCPR business PayPal account via
   the PayPal Invoicing API — this gives the recipient a PayPal-hosted payment page
4. **Inserts an `invoices` row** in the database with `status = 'sent'`, storing
   the PayPal invoice ID and payment link
5. **Logs the creation** in `invoice_activity_log`
6. **Sends an email** to the recipient via Resend with the payment link

**Plain English:** The instructor creates a bill, PayPal generates a payment page for
the recipient, and an email is sent to the company contact with a link to pay.

---

## Step 2 — Recipient pays on PayPal

This happens entirely outside the app. The recipient opens the PayPal-hosted invoice
link, pays with their PayPal account or credit card, and PayPal processes the payment.

The money lands in **SuperHeroCPR's** business PayPal account. The app is not
automatically notified — the instructor watches their PayPal dashboard or email
and comes back to mark it paid manually.

**Plain English:** The customer pays through PayPal's website. SuperHeroCPR collects
the money. The app has no webhook for this — the instructor is the human bridge.

---

## Step 3 — Instructor marks the invoice paid

**Page:** `/admin/invoices/[id]`  
**Code:** `POST /api/invoices/mark-paid`

The instructor opens the invoice detail page and clicks "Mark as Paid." The API:

1. **Authenticates** — instructor or super_admin only
2. **Calls the `mark_invoice_paid()` Postgres RPC** (migration 0016), which:
   - Acquires a **row-level lock** on the invoice row (prevents double-click double-booking)
   - Verifies `status = 'sent'` (already-paid or cancelled invoices are rejected)
   - Sets `status = 'paid'`, records `paid_at`
   - **Inserts one `bookings` row per student slot** with `booking_source = 'invoice'`
     so each student slot is counted against the session's capacity
   - Logs the action in `invoice_activity_log`
3. **Records instructor earnings** via `recordInvoiceEarning()` — calculates the
   platform fee split and inserts into `instructor_earnings` with `status = 'pending'`
4. **Optionally triggers an immediate payout** if the system is in immediate mode
5. **Sends a paid confirmation email** to the instructor (best-effort, non-fatal)

**Plain English:** The instructor confirms the money arrived. The system locks the
invoice so it can't be marked paid twice, fills the class seats for every student on
the invoice, and queues up the instructor's share for payout.

---

## Step 4 — Instructor payout

The `instructor_earnings` row created in Step 3 feeds into the standard payout
system. See [payout-system.md](payout-system.md) for the full flow from that point.

---

## Other invoice actions

### Resend invoice
**Code:** `POST /api/invoices/resend`

Resends the invoice email. If the admin or instructor provides a corrected email
address, it updates `invoices.recipient_email` before resending. Logs the action.

### Cancel invoice
**Code:** `POST /api/invoices/cancel`

1. Calls the PayPal API to **void the invoice on PayPal first**
2. Only if PayPal accepts the void: sets `status = 'cancelled'` locally
3. Logs the cancellation

If PayPal rejects the void (e.g. invoice already paid), the DB is not touched and
an error is returned. The instructor must resolve it in PayPal directly.

**Plain English:** Cancelling voids the payment link first. If that fails for any
reason, nothing changes locally — the system stays in sync with PayPal.

---

## Invoice status lifecycle

```
[Created]
    ↓
  sent  ──── recipient pays on PayPal ────► (instructor marks paid)
    |                                               ↓
    └── instructor cancels ─────────────────► cancelled
                                                    
  sent → paid  (instructor_earnings inserted, bookings inserted)
```

---

## Key files

| File | Role |
|---|---|
| `app/(admin)/admin/invoices/new/page.tsx` | Create invoice form |
| `app/(admin)/admin/invoices/[id]/page.tsx` | Invoice detail, mark paid, cancel, resend |
| `app/api/invoices/create/route.ts` | Creates PayPal invoice + DB record + sends email |
| `app/api/invoices/mark-paid/route.ts` | Atomic mark-paid RPC + earnings record |
| `app/api/invoices/cancel/route.ts` | Voids PayPal invoice + cancels DB record |
| `app/api/invoices/resend/route.ts` | Resends invoice email, optionally corrects address |
| `lib/instructor-earnings.ts` | Calculates and inserts payout-ready earning records |
| `lib/payout-trigger.ts` | Optionally fires immediate payout after mark-paid |
