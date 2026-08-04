# Admin Orders Management Build Guide
**Route:** `/admin/orders`
**File:** `app/(admin)/orders/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the orders management page for **Superhero CPR**. Super admins manage all merch orders from this page — marking orders as shipped, adding tracking numbers, marking delivered, cancelling, and issuing full or partial refunds via PayPal. Shipping confirmation emails are sent automatically via Resend when an order is marked shipped.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for shipping confirmation emails
- **PayPal API** — for refunds

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Super Admin only.

---

## Architecture

Hybrid — server fetches paginated orders with filters applied via URL params. Order detail expands inline client-side (data already loaded). Mutations via API routes.

---

## Data Fetching

```typescript
const page = parseInt(searchParams.page ?? '1')
const pageSize = 50
const offset = (page - 1) * pageSize

let query = supabase
  .from('orders')
  .select(`
    id, status, total_amount, paypal_transaction_id,
    shipping_name, shipping_address, shipping_city,
    shipping_state, shipping_zip, tracking_number,
    notes, created_at, updated_at,
    profiles!customer_id ( id, first_name, last_name, email ),
    order_items (
      id, quantity, price_at_purchase,
      product_variants (
        size,
        products ( name, image_url )
      )
    )
  `, { count: 'exact' })
  .order('created_at', { ascending: false })
  .range(offset, offset + pageSize - 1)

// Apply filters from URL params
if (searchParams.status) query = query.eq('status', searchParams.status)
if (searchParams.from) query = query.gte('created_at', searchParams.from)
if (searchParams.to) query = query.lte('created_at', searchParams.to + 'T23:59:59')

const { data: orders, count } = await query
const totalPages = Math.ceil((count ?? 0) / pageSize)
```

---

## Page Header

- `<h1>`: `"Orders"`
- Order count: `"[total] orders"`

---

## Filter Bar

Always visible above the list.

**Filters:**
- **Status** (pill buttons): All / Pending / Paid / Shipped / Delivered / Cancelled
- **Date range**: From / To date inputs
- **Customer search**: text input — searches by name or email, added to URL on Enter
- **Clear filters** link when any filter active

Filter changes update URL params, trigger new server render.

---

## Orders List

Table on desktop, cards on mobile.

**Each order row shows:**
- Order date — `"Apr 14, 2026"`
- Customer name + email (muted below)
- Items summary — `"[n] item${n !== 1 ? 's' : ''}"` with product names listed: `"CPR T-Shirt (M), Keychain"`
- Total — formatted currency, bold
- Status badge:
  - `pending` → amber `"Pending"`
  - `paid` → blue `"Paid"`
  - `shipped` → purple `"Shipped"`
  - `delivered` → green `"Delivered"`
  - `cancelled` → gray `"Cancelled"`
- Tracking number — shown if present, muted small text
- **Expand button** — chevron, toggles inline detail panel

---

## Expanded Order Detail

Accordion panel below the row — no separate page needed.

**Sections:**

**Shipping address:**
```
[shipping_name]
[shipping_address]
[shipping_city], [shipping_state] [shipping_zip]
```

**Line items table:**
| Product | Size | Qty | Unit price | Subtotal |
| CPR T-Shirt | M | 2 | $25.00 | $50.00 |

**Order total:** shown at bottom right of line items

**PayPal transaction ID** — monospace, shown if present

**Notes** — shown if present

**Actions** — shown based on current status:

---

## Actions Per Status

### Status: `paid`
- **Mark as Shipped** button — opens inline form:
  ```
  Tracking number: [text input, required]
  Carrier: [optional text input e.g. "UPS", "USPS", "FedEx"]
  [Cancel]  [Mark Shipped & Send Email]
  ```
  On confirm:
  1. Update `orders.status = 'shipped'`
  2. Update `orders.tracking_number`
  3. Send shipping confirmation email via Resend (see Email section)
  4. Refresh order row

### Status: `shipped`
- **Mark as Delivered** button — one click, no confirmation
  - Updates `orders.status = 'delivered'`
- **Update Tracking** — inline input to correct tracking number if needed
- Tracking number displayed prominently

### Status: `paid` or `shipped` or `delivered`
- **Cancel Order** button (super admin only) — red outline
  - Opens inline confirmation:
    ```
    "Cancel this order? This will issue a refund via PayPal."
    Refund amount: $[total] (full refund — editable down to $0.01)
    [Cancel]  [Confirm Cancellation & Refund]
    ```
  - Refund amount defaults to full order total
  - Super admin can reduce the amount for a partial refund
  - Minimum refund: $0.01. Maximum: order total.
  - On confirm: calls cancel/refund API route

### Status: `cancelled`
- No actions — shows `"This order has been cancelled."` + refund amount if applicable

### All statuses
- **Add/Edit Notes** — inline textarea for fulfillment notes
  - Auto-saves on blur
  - Label: `"Internal notes (not visible to customer)"`

---

## Shipping Confirmation Email

Sent via Resend when order marked shipped.

```typescript
await resend.emails.send({
  from: 'Superhero CPR <noreply@superherocpr.com>',
  to: customer.email,
  subject: 'Your Superhero CPR order has shipped!',
  html: `
    <h1>Your order is on the way, ${customer.first_name}!</h1>
    <p>Your Superhero CPR order has shipped.</p>
    ${trackingNumber ? `
      <p><strong>Tracking number:</strong> ${trackingNumber}</p>
      ${carrier ? `<p><strong>Carrier:</strong> ${carrier}</p>` : ''}
    ` : ''}
    <h3>Your order:</h3>
    ${orderItemsHtml}
    <p><strong>Total: $${order.total_amount}</strong></p>
    <p>Shipping to: ${order.shipping_name}, ${order.shipping_city}, ${order.shipping_state}</p>
    <p>— The Superhero CPR Team</p>
  `,
})
```

---

## Cancel & Refund API Route

**File:** `app/api/orders/cancel-refund/route.ts`

```typescript
export async function POST(request: Request) {
  const supabase = createClient()
  const { orderId, refundAmount } = await request.json()

  // Verify super admin
  // Fetch order
  const { data: order } = await supabase
    .from('orders')
    .select('id, total_amount, paypal_transaction_id, status')
    .eq('id', orderId)
    .single()

  if (!order || order.status === 'cancelled') {
    return Response.json({ success: false, error: 'Order cannot be cancelled.' }, { status: 400 })
  }

  // Validate refund amount
  if (refundAmount <= 0 || refundAmount > order.total_amount) {
    return Response.json({ success: false, error: 'Invalid refund amount.' }, { status: 400 })
  }

  // Issue refund via PayPal API
  if (order.paypal_transaction_id) {
    const paypalRes = await fetch(
      `https://api-m.paypal.com/v2/payments/captures/${order.paypal_transaction_id}/refund`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await getPayPalToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: {
            value: refundAmount.toFixed(2),
            currency_code: 'USD',
          },
          note_to_payer: 'Refund from Superhero CPR',
        }),
      }
    )

    if (!paypalRes.ok) {
      return Response.json(
        { success: false, error: 'PayPal refund failed. Order not cancelled.' },
        { status: 500 }
      )
    }
  }

  // Update order status
  await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      notes: `Cancelled and refunded $${refundAmount.toFixed(2)} on ${new Date().toLocaleDateString()}`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)

  // Restore stock for each order item
  const { data: items } = await supabase
    .from('order_items')
    .select('variant_id, quantity')
    .eq('order_id', orderId)

  for (const item of items ?? []) {
    await supabase.rpc('increment_stock', {
      variant_id: item.variant_id,
      amount: item.quantity,
    })
  }

  return Response.json({ success: true })
}
```

**Important:** PayPal refund must succeed before updating order status. If PayPal fails, do not cancel the order — show the error to the super admin.

**Stock restoration:** When an order is cancelled, stock is restored for each item using an `increment_stock` RPC function (opposite of `decrement_stock`).

---

## Supabase RPC — `increment_stock`

Add to schema-notes.md:

```sql
create or replace function increment_stock(variant_id uuid, amount int)
returns void as $$
  update product_variants
  set stock_quantity = stock_quantity + amount
  where id = variant_id;
$$ language sql;
```

---

## Mark Shipped API Route

**File:** `app/api/orders/mark-shipped/route.ts`

```typescript
export async function POST(request: Request) {
  const { orderId, trackingNumber, carrier } = await request.json()

  // Update order
  await supabase
    .from('orders')
    .update({
      status: 'shipped',
      tracking_number: trackingNumber,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)

  // Send shipping email via Resend
  // (fetch order + customer details, then send)
}
```

---

## Mark Delivered API Route

**File:** `app/api/orders/mark-delivered/route.ts`

```typescript
export async function POST(request: Request) {
  const { orderId } = await request.json()
  await supabase
    .from('orders')
    .update({ status: 'delivered', updated_at: new Date().toISOString() })
    .eq('id', orderId)
  return Response.json({ success: true })
}
```

---

## Pagination

Same pattern as payments page:
```
Showing [start]–[end] of [total] orders
[← Previous]  [Page 1 of N]  [Next →]
```

URL-based, previous/next are `<Link>` components.

---

## Empty State

- Icon: `ShoppingBag` from Lucide
- Text: `"No orders found matching your filters."`
- Clear filters link if filters active
- `"No orders yet."` if no orders at all

---

## Responsive

- Mobile: Card layout — each order is a card, detail expands below
- Desktop: Table with accordion expansion

---

## Accessibility

- Expanded order detail must use `aria-expanded` on the toggle button
- Refund amount input must have `aria-label="Refund amount in dollars"`
- Status badges must convey meaning through text not color alone
- Shipping form inputs must have `<label>` elements

---

## What NOT to Do

- Do not update order status if PayPal refund fails
- Do not allow refund amount to exceed order total
- Do not forget to restore stock on cancellation
- Do not send shipping email before DB is updated
- Do not allow cancel/refund for manager role — super admin only
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to super admin
- [ ] Pagination works — 50 per page, URL-based
- [ ] All filters work with URL params
- [ ] Orders list shows correct info per row
- [ ] Status badges correct
- [ ] Order detail expands inline with full address and line items
- [ ] Mark as shipped — requires tracking number, sends Resend email
- [ ] Shipping email includes tracking number and order items
- [ ] Mark as delivered — one click
- [ ] Cancel order — PayPal refund called first, DB updated only on success
- [ ] Partial refund amount validated (min $0.01, max order total)
- [ ] Stock restored on cancellation via increment_stock RPC
- [ ] Notes auto-save on blur
- [ ] Empty state renders correctly
- [ ] Fully responsive — table desktop, cards mobile
- [ ] No TypeScript errors
- [ ] No ESLint errors
