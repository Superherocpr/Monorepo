# Orders and Merch Flow — How It Works

A technical and plain-English walkthrough of how a customer buys merchandise,
from browsing the store to the admin marking the order delivered.

---

## Overview

The merch store sells physical products (shirts, accessories, etc.) with size/variant
options. Customers build a cart, pay through PayPal, and the app atomically reserves
stock. The admin then fulfills the order manually and updates the status as they go.

---

## Step 1 — Customer browses and builds a cart

**Page:** `/merch` (public, no login required)  
**Code:** `MerchClient.tsx`

The merch page loads all active products with their variants (sizes, colors) and
current stock levels. Out-of-stock variants are shown as disabled.

Cart state is managed client-side in a Zustand store (`lib/cart-store.ts`) and
persisted in `localStorage`. The cart survives page refreshes but is not saved
to the database — it only matters during checkout.

**Plain English:** The customer adds items to their cart like any normal online store.
The cart lives in their browser and is not tracked server-side until they pay.

---

## Step 2 — Customer enters shipping info

**Page:** `/merch/checkout` (or inline on the merch page)

The customer provides:
- Full name, email address
- Shipping address (street, city, state, zip)

A flat shipping rate is applied (configured via `NEXT_PUBLIC_SHIPPING_RATE`).
The displayed total is computed client-side: `(sum of variant prices × quantities) + shipping`.

**Plain English:** The customer fills in where to ship and sees the total before paying.

---

## Step 3 — Customer pays via PayPal

The PayPal button renders client-side with the computed total. The customer
completes checkout in the PayPal popup (PayPal account or guest card). PayPal
returns an `orderId` to the browser — **the card has not been charged yet**.

**Plain English:** The customer goes through PayPal checkout. The app gets a
reference number but hasn't charged the card yet.

---

## Step 4 — Server-side confirmation

**Code:** `POST /api/orders/confirm`  
Called by the browser immediately after PayPal's `onApprove` callback.

### 4a. Server-side price verification (THREAT-003)
The API ignores the total the client sent. It re-fetches every cart variant's
price from the database, recomputes the total (including shipping), and compares
it to the client's declared amount. If the difference exceeds $0.01, the request
is rejected before any money moves.

### 4b. Capture the PayPal payment
The API calls PayPal's `/v2/checkout/orders/{orderId}/capture` server-to-server.
The customer's card or PayPal balance is charged here. The response includes a
`captureId` used for refunds if anything fails later.

### 4c. Atomic stock reservation (THREAT-010)
For each cart item, the API calls the `decrement_stock_if_available` Postgres RPC.
This atomically:
- Checks that stock ≥ requested quantity
- Decrements stock with `GREATEST(stock - amount, 0)` to prevent negative stock

If any item runs out of stock between the customer adding it to their cart and
the server processing the order, the already-reserved stock for other items is
**released back** and the PayPal capture is **refunded automatically**.

### 4d. Create order records
An `orders` row and one `order_items` row per line item are inserted with
`status = 'paid'`, storing the PayPal capture ID, shipping details, and item quantities.

### 4e. Confirmation emails
- **Customer** receives an order confirmation email via Resend listing their items,
  total, and shipping address
- **Business** (SuperHeroCPR) receives an order notification email so the team
  knows to prepare the shipment

Both emails are best-effort — if they fail, the order still exists in the database.

**Plain English:** The server re-checks the prices and stock, charges the card,
grabs the items from inventory, and sends confirmation emails to the customer
and the business.

---

## Step 5 — Admin fulfills the order

**Page:** `/admin/orders`  
**Code:** `MerchAdminClient.tsx`

The admin sees all orders sorted by status. The fulfillment flow is:

### Mark Shipped — `POST /api/orders/mark-shipped`
1. Admin enters tracking number (and optional carrier)
2. Order `status` updates from `'paid'` → `'shipped'`
3. Tracking number is stored on the order
4. **Shipping confirmation email** is sent to the customer with the tracking number

### Mark Delivered — `POST /api/orders/mark-delivered`
1. Admin clicks "Mark Delivered"
2. Order `status` updates from `'shipped'` → `'delivered'`
3. No email is sent at this step

**Plain English:** The admin ships the package, enters the tracking number (which
emails the customer), and can later mark it as delivered once confirmed.

---

## Step 6 — Cancellations and refunds

**Code:** `POST /api/orders/cancel-refund`

A super_admin can cancel and refund an order. The API:

1. **Issues a PayPal refund first** — uses the stored `paypal_transaction_id` (the capture ID) to call `/v2/payments/captures/{id}/refund` with the specified refund amount
2. Supports **partial refunds** — minimum $0.01, maximum the order total
3. Only if PayPal accepts the refund: updates `status = 'cancelled'` locally
4. **Restores stock** for each line item via the `increment_stock` Postgres RPC

If the PayPal refund fails for any reason, the order is not cancelled in the database.
The system stays in sync with PayPal at all times.

**Plain English:** Refunds go through PayPal first. If PayPal agrees, the system cancels
the order and puts the items back in stock. If PayPal rejects it for any reason, nothing
changes locally.

---

## Key safety mechanisms

| Risk | Mechanism |
|---|---|
| Customer pays a manipulated price | Server recomputes total from DB prices, rejects any mismatch > $0.01 |
| Two customers buy the last item simultaneously | `decrement_stock_if_available` RPC uses atomic update with GREATEST check |
| Stock runs out after payment captured | Captured payment is automatically refunded, stock released |
| Admin accidentally double-ships | `mark-shipped` rejects orders not in `'paid'` status |
| Refund issued without actual PayPal reversal | PayPal API is called first; DB only updates on PayPal success |

---

## Order status lifecycle

```
Customer pays
    ↓
POST /api/orders/confirm
    ├── Price check passes?
    ├── PayPal capture succeeds?
    ├── Stock available?
    │       YES → orders + order_items inserted (status: paid)
    │              confirmation emails sent
    │       NO  → stock released, PayPal capture refunded
    ↓
  paid
    ↓ (admin ships)
  shipped  ← tracking number saved, customer emailed
    ↓ (admin confirms delivery)
  delivered

  paid/shipped → cancelled  (PayPal refund + stock restored)
```

---

## Key files

| File | Role |
|---|---|
| `app/(public)/merch/_components/MerchClient.tsx` | Public store page with cart and checkout |
| `app/api/orders/confirm/route.ts` | Price check, PayPal capture, stock reservation, order creation |
| `app/api/orders/mark-shipped/route.ts` | Updates status, saves tracking, emails customer |
| `app/api/orders/mark-delivered/route.ts` | Updates status to delivered |
| `app/api/orders/cancel-refund/route.ts` | PayPal refund + order cancellation + stock restore |
| `app/api/orders/update-notes/route.ts` | Admin internal notes on an order |
| `app/(admin)/admin/orders/page.tsx` | Admin order management dashboard |
| `app/(public)/dashboard/orders/page.tsx` | Customer order history |
| `lib/cart-store.ts` | Client-side Zustand cart store (persisted to localStorage) |
| `types/merch.ts` | TypeScript types for products, variants, cart items |
