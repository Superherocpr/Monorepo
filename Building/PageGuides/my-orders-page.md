# My Orders Page Build Guide
**Route:** `/dashboard/orders`
**File:** `app/(public)/dashboard/orders/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/dashboard/orders` page for **Superhero CPR**. This page shows a logged-in customer all of their merch orders, fully expanded. It is fully server-rendered and read-only.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

This page is protected by the dashboard layout auth guard in `app/(public)/dashboard/layout.tsx`. No additional auth check needed beyond confirming the user exists.

---

## Architecture

Fully server-rendered. No client components. All data fetched in `page.tsx` before render.

---

## Data Fetching

```typescript
const supabase = createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/book/signin?redirect=/dashboard/orders')

const { data: orders } = await supabase
  .from('orders')
  .select(`
    id,
    status,
    total_amount,
    tracking_number,
    shipping_name,
    shipping_address,
    shipping_city,
    shipping_state,
    shipping_zip,
    created_at,
    order_items (
      id,
      quantity,
      price_at_purchase,
      product_variants (
        size,
        products ( name, image_url )
      )
    )
  `)
  .eq('customer_id', user.id)
  .order('created_at', { ascending: false })
```

**Define TypeScript interface in `types/orders.ts`:**
```typescript
export interface OrderRecord {
  id: string
  status: 'pending' | 'paid' | 'shipped' | 'delivered'
  total_amount: number
  tracking_number: string | null
  shipping_name: string
  shipping_address: string
  shipping_city: string
  shipping_state: string
  shipping_zip: string
  created_at: string
  order_items: {
    id: string
    quantity: number
    price_at_purchase: number
    product_variants: {
      size: string
      products: {
        name: string
        image_url: string | null
      }
    }
  }[]
}
```

---

## Your Task

Build the complete `/dashboard/orders` page. Components live in `app/(public)/dashboard/orders/_components/`.

---

## Section 1 — Page Header

**Component:** `OrdersPageHeader.tsx`
**Type:** Server component

**Content — hardcoded:**
- `<h1>`: `"My Orders"`
- Subtext: `"Your Superhero CPR merchandise orders."`

---

## Section 2 — Orders List

**Component:** `OrdersList.tsx`
**Type:** Server component

**Props:**
```typescript
interface OrdersListProps {
  orders: OrderRecord[]
}
```

**Visibility:** If `orders.length === 0`, render empty state:
- Icon: `ShoppingBag` from Lucide React, `text-gray-300`, size 48px
- Heading: `"No orders yet"`
- Body: `"Browse our merchandise and rep the Superhero CPR mission."`
- CTA button: `"Shop Merch"` → `/merch`

**Layout:** Vertical stack of order cards, most recent first (already sorted by query).

**Each order card (`OrderCard.tsx`):**

Break each order card into its own sub-component `OrderCard.tsx` — do not inline all card logic in `OrdersList.tsx`.

**Props:**
```typescript
interface OrderCardProps {
  order: OrderRecord
}
```

**Card layout — four sections separated by dividers:**

### Card Header
- Left: Order date — `"Order placed [formatted date]"` e.g. `"Order placed April 14, 2026"`
- Left below date: Order ID — `"Order #[first 8 chars of id]"` in muted small text
- Right: Status badge

**Status badge styles:**
```typescript
const statusStyles = {
  pending:   'bg-gray-100 text-gray-600',
  paid:      'bg-blue-100 text-blue-800',
  shipped:   'bg-amber-100 text-amber-800',
  delivered: 'bg-green-100 text-green-800',
}
const statusLabels = {
  pending:   'Pending',
  paid:      'Processing',
  shipped:   'Shipped',
  delivered: 'Delivered',
}
```

### Items List
One row per order item:
- Product image thumbnail (40x40px square) — use Next.js `<Image>`. If `image_url` is null, render a gray placeholder square.
- Product name — bold
- Size — muted: `"Size: [size]"`
- Quantity — muted: `"Qty: [quantity]"`
- Line total — right-aligned: `"$[price_at_purchase × quantity formatted as currency]"`

### Order Summary
Right-aligned summary block:
- Subtotal: sum of all `price_at_purchase × quantity`
- Shipping: derive from `total_amount - subtotal`. If 0: `"Free"`. If > 0: formatted as currency.
- **Total: `total_amount` formatted as currency — bold**

```typescript
function computeSubtotal(items: OrderRecord['order_items']): number {
  return items.reduce((sum, item) => sum + item.price_at_purchase * item.quantity, 0)
}
```

### Shipping Info + Tracking
- **Shipping address block:**
  ```
  Shipped to:
  [shipping_name]
  [shipping_address]
  [shipping_city], [shipping_state] [shipping_zip]
  ```
- **Tracking number:** If `tracking_number` is not null:
  `"Tracking: [tracking_number]"` — plain text, not a link (carrier unknown)
  
  If `tracking_number` is null and status is `'shipped'`:
  `"Tracking number not yet available"` in muted text
  
  If status is `'pending'` or `'paid'`:
  Do not show any tracking row at all.

---

## Page Assembly

**File:** `app/(public)/dashboard/orders/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OrdersPageHeader from './_components/OrdersPageHeader'
import OrdersList from './_components/OrdersList'
import type { OrderRecord } from '@/types/orders'

export const metadata = {
  title: 'My Orders | Superhero CPR',
}

export default async function OrdersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/book/signin?redirect=/dashboard/orders')

  const { data: orders } = await supabase
    .from('orders')
    .select(`
      id, status, total_amount, tracking_number,
      shipping_name, shipping_address, shipping_city,
      shipping_state, shipping_zip, created_at,
      order_items (
        id, quantity, price_at_purchase,
        product_variants (
          size,
          products ( name, image_url )
        )
      )
    `)
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <main>
      <OrdersPageHeader />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <OrdersList orders={(orders ?? []) as OrderRecord[]} />
      </div>
    </main>
  )
}
```

---

## Responsive Breakpoints

- Mobile: Single column. Items list stacks vertically. Order summary right-aligned below items.
- Desktop (`lg`+): Max width `4xl` centered. Same layout with more breathing room.

Image thumbnails: always 40x40px regardless of screen size.

---

## Typography & Brand

- **Order cards:** White bg, `border border-gray-200 rounded-lg overflow-hidden`
- **Card header:** `bg-gray-50 px-5 py-4 flex items-center justify-between`
- **Card sections:** `px-5 py-4 border-t border-gray-100`
- **Order date:** `text-sm font-medium text-gray-900`
- **Order ID:** `text-xs text-gray-400 mt-0.5`
- **Item name:** `text-sm font-medium text-gray-900`
- **Item details (size/qty):** `text-xs text-gray-500`
- **Line total:** `text-sm text-gray-900 font-medium`
- **Summary labels:** `text-sm text-gray-500`
- **Summary values:** `text-sm text-gray-900`
- **Total row:** `text-base font-semibold text-gray-900`
- **Shipping address:** `text-sm text-gray-600`
- **Tracking:** `text-sm font-mono text-gray-700`

---

## Accessibility Requirements

- `<h1>` is the page title only
- Order card headings (order date) are `<h2>` or treated as a visually distinct header row — do not use heading tags inside card headers unless semantically appropriate. Use `<p>` with bold styling for the order date.
- Status badges must include text label — never color alone
- Product image thumbnails must have `alt="[product name]"`
- Placeholder image divs must have `aria-label="[product name] — no image available"`
- Tracking number displayed as `<code>` element for monospace styling: `<code className="font-mono text-sm">[tracking_number]</code>`

---

## What NOT to Do

- Do not add order cancellation or return UI — this page is read-only
- Do not use client components — fully server-rendered
- Do not inline all card logic in `OrdersList.tsx` — use `OrderCard.tsx` sub-component
- Do not hardcode shipping cost — derive it from `total_amount - subtotal`
- Do not show tracking section for pending or paid orders
- Do not use `any` TypeScript types — use `OrderRecord` from `types/orders.ts`
- Do not use a broken `<img>` for missing product images — use a placeholder div
- Do not use inline styles — Tailwind only

---

## Definition of Done

The page is complete when:
- [ ] Unauthenticated users redirect to sign in
- [ ] Empty state renders with Shop Merch CTA when no orders exist
- [ ] All orders render correctly in reverse chronological order
- [ ] Each order card shows header, items list, summary, and shipping info
- [ ] Status badge shows correct color and label per status
- [ ] Product image thumbnails render — placeholder div for null image_url
- [ ] Line totals computed correctly per item
- [ ] Subtotal, shipping, and total computed and displayed correctly
- [ ] Shipping cost shows "Free" if 0
- [ ] Tracking number shown for shipped orders, hidden for pending/paid
- [ ] "Tracking number not yet available" shown for shipped orders with no tracking number
- [ ] Tracking number displayed in monospace `<code>` element
- [ ] Page fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export
