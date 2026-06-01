# Booking Flow — How It Works

A technical and plain-English walkthrough of how a customer books a class,
from landing on the schedule page to receiving their confirmation email.

---

## Overview

Customers browse the public schedule, pick a class, pay through PayPal, and
the app atomically reserves their seat — all without requiring an account first.
Payment goes to SuperHeroCPR's business PayPal account; the instructor's share
is queued for payout separately.

---

## Step 1 — Customer browses the schedule and selects a class

**Page:** `/schedule` (public)

The schedule page shows all upcoming approved class sessions with their class type,
date, time, location, price, and spots remaining. Spots remaining is computed
server-side by subtracting confirmed non-cancelled bookings from `max_capacity`.

When the customer clicks "Book Now", they are taken to the booking flow for
that specific `session_id`.

**Plain English:** The customer picks a class from the public schedule page.

---

## Step 2 — Booking flow pages (multi-step)

**Pages:** `/book/[sessionId]/...`

The booking flow walks the customer through:

1. **Class details confirmation** — shows what they are booking and the price
2. **Customer info** — name, email (no account required)
3. **Payment** — PayPal button renders client-side via the PayPal JS SDK

At the payment step, the PayPal button is loaded with the class price from
`NEXT_PUBLIC_` safe data. The customer completes PayPal checkout in the PayPal
popup (PayPal account or guest card payment). PayPal returns an `orderId` to
the browser — **no money has moved yet at this point**.

**Plain English:** The customer fills in their details and goes through PayPal's
checkout. PayPal gives the app an order ID but the card hasn't been charged yet.

---

## Step 3 — Server-side confirmation

**Code:** `POST /api/bookings/confirm`  
Called by the browser immediately after PayPal's `onApprove` callback.

This is where all the real work happens, in order:

### 3a. Server-side price verification (THREAT-013)
The API ignores the price the client sent. It re-fetches the canonical price
from `class_sessions → class_types.price` and compares it to the client amount.
If the difference is more than $0.01, the request is rejected before any money moves.

### 3b. Capture the PayPal payment
The API calls PayPal's `/v2/checkout/orders/{orderId}/capture` endpoint
server-to-server. This is when the customer's card or PayPal balance is actually
charged. The response includes a `captureId` used for refunds if anything goes wrong.

### 3c. Atomic spot reservation (THREAT-006)
The API calls the `book_spot` Postgres RPC, which:
- Locks the session row
- Counts current non-cancelled bookings
- Rejects if `current_bookings >= max_capacity` (class filled during checkout)
- Inserts the `bookings` row if a spot is available

If the class filled up between the customer starting checkout and the server
running `book_spot`, the API **automatically refunds the PayPal capture** via
`/v2/payments/captures/{captureId}/refund` and returns a "class is full" error
to the customer. No manual intervention needed.

### 3d. Payment record
A `payments` row is inserted with the PayPal capture ID, amount, and customer details.

### 3e. Instructor earning
`recordBookingEarning()` calculates the platform fee split and inserts an
`instructor_earnings` row with `status = 'pending'` for the payout queue.

### 3f. Confirmation email
A booking confirmation email is sent to the customer via Resend. This is
best-effort — if the email fails, the booking still stands.

### 3g. Immediate payout trigger (optional)
If the system is configured for immediate payout mode,
`maybeTriggerImmediatePayout()` fires a background request to kick off a
PayPal payout batch. This is non-blocking — it does not delay the customer's
confirmation response.

**Plain English:** The server verifies the price hasn't changed, charges the card,
tries to grab the last open spot, and if another customer just took it, immediately
refunds the card and apologizes. If the seat is theirs, a confirmation email goes out.

---

## Step 4 — Customer sees their booking

**Page:** `/dashboard/bookings` (requires login)

Bookings are visible in the customer's dashboard under "My Bookings", grouped
into upcoming, past, and cancelled. Each booking shows the class name, date,
location, and a certificate download link once it has been issued post-class.

**Plain English:** The customer can log in and see all their upcoming and past classes.

---

## Key safety mechanisms

| Risk | Mechanism |
|---|---|
| Customer pays a price different from the listed price | Server re-fetches price from DB and rejects any mismatch > $0.01 |
| Two customers simultaneously grab the last seat | `book_spot` RPC uses `FOR UPDATE` lock; one gets the seat, the other gets a refund |
| Customer abandons mid-checkout after PayPal approval | Spot is not reserved until `confirm` completes — no orphaned bookings |
| Confirmation API called twice with same PayPal order | `book_spot` unique constraint on `(session_id, customer_id)` prevents double-booking |

---

## Booking status lifecycle

```
Customer clicks "Book Now"
    ↓
PayPal checkout (client-side) → orderId returned
    ↓
POST /api/bookings/confirm
    ├── Price check passes?
    ├── PayPal capture succeeds?
    ├── book_spot RPC: seat available?
    │       YES → bookings row inserted (cancelled = false)
    │              payment row inserted
    │              instructor_earnings inserted (status: pending)
    │              confirmation email sent
    │       NO  → PayPal capture refunded automatically
    └── Response to customer
```

---

## Key files

| File | Role |
|---|---|
| `app/(public)/schedule/...` | Public schedule browsing |
| `app/(public)/book/[sessionId]/...` | Multi-step booking flow pages |
| `app/api/bookings/confirm/route.ts` | Price check, PayPal capture, spot reservation, earnings |
| `lib/instructor-earnings.ts` | Calculates and records instructor payout row |
| `lib/payout-trigger.ts` | Fires optional immediate payout after booking |
| `app/(public)/dashboard/bookings/page.tsx` | Customer booking history dashboard |
