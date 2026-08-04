# Merch Page Build Guide
**Route:** `/merch`
**File:** `app/(public)/merch/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/merch` page for **Superhero CPR**. This page is a simple merchandise catalog with a cart drawer and PayPal checkout. Guest checkout is supported — no account required to purchase. Cart state persists in `localStorage`.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database (`@supabase/ssr`)
- **PayPal JS SDK** — for checkout
- **Resend** — for order confirmation emails

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching or insert logic. Do not guess at table or column names.

---

## Shipping Rate

The flat shipping rate is stored as an environment variable so it can be updated without a code change:

```
NEXT_PUBLIC_SHIPPING_RATE=0
```

Add this to `.env.local` and `.env.local.example`:
```
# Merch
NEXT_PUBLIC_SHIPPING_RATE=          # Flat shipping rate in USD e.g. 5.99
```

Access in code as:
```typescript
const SHIPPING_RATE = parseFloat(process.env.NEXT_PUBLIC_SHIPPING_RATE ?? '0')
```

Leave a comment wherever this is used: `// TODO: set NEXT_PUBLIC_SHIPPING_RATE in environment variables`

---

## Architecture Overview

This page uses a **server + client split**:

- `page.tsx` — server component that fetches all products and variants, passes to client
- `MerchClient.tsx` — client component owning cart state, product display, and checkout
- Cart state lives in `localStorage` and React state (synced on mount)
- PayPal checkout fires an API route that creates the order and sends emails

---

## Cart State — localStorage

Define a typed cart store in `lib/cart-store.ts`:

```typescript
export interface CartItem {
  variantId: string
  productId: string
  productName: string
  productImage: string | null
  size: string
  price: number
  quantity: number
}

const CART_KEY = 'superhero_cpr_cart'

export function getCart(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CART_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function setCart(items: CartItem[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(CART_KEY, JSON.stringify(items))
}

export function clearCart(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(CART_KEY)
}
```

---

## Data Fetching — Server Side Only

All data fetching happens in `page.tsx`:

```typescript
const { data: products } = await supabase
  .from('products')
  .select(`
    id,
    name,
    description,
    price,
    image_url,
    product_variants (
      id,
      size,
      stock_quantity
    )
  `)
  .eq('active', true)
  .order('name')
```

Define explicit TypeScript interfaces in `types/merch.ts`:

```typescript
export interface ProductVariant {
  id: string
  size: string
  stock_quantity: number
}

export interface Product {
  id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  product_variants: ProductVariant[]
}
```

Pass `products` as a prop to `MerchClient`.

---

## Your Task

Build the complete `/merch` page. Components live in `app/(public)/merch/_components/`.

---

## Section 1 — Hero

**Component:** `MerchHeroSection.tsx`
**Type:** Server component

**Layout:** Full-width, centered, compact height

**Content — hardcoded:**
- Section label (small caps, red): `"Gear Up"`
- Headline: `"Superhero CPR Merch"`
- Subtext: `"Rep the mission. Every purchase helps spread the word about CPR awareness."`

No data fetching.

---

## Section 2 — Merch Client (Catalog + Cart)

**Component:** `MerchClient.tsx`
**Type:** Client component (`"use client"`)

**Props:**
```typescript
interface MerchClientProps {
  products: Product[]
}
```

This component owns:
- Cart state (synced with localStorage)
- Selected size per product
- Selected quantity per product
- Cart drawer open/close state
- Checkout flow state

### Cart Initialization

On mount, load cart from localStorage:
```typescript
const [cartItems, setCartItems] = useState<CartItem[]>([])

useEffect(() => {
  setCartItems(getCart())
}, [])
```

Whenever `cartItems` changes, sync to localStorage:
```typescript
useEffect(() => {
  setCart(cartItems)
}, [cartItems])
```

### Product Grid

**Layout:** Responsive grid — 1 col mobile, 2 col tablet, 3 col desktop

**Empty state:** If no products exist, render:
- Centered message: `"No products available yet. Check back soon!"`

**Each product card:**
- Product image — use Next.js `<Image>`. If `image_url` is null, render a gray placeholder div with the product name centered. Never a broken `<img>`.
- Product name — bold
- Description — muted, clamped to 2 lines (`line-clamp-2`)
- Price — formatted as currency
- Size selector — a row of pill buttons, one per variant. Sort sizes in logical order: XS, S, M, L, XL, XXL, One Size. Disabled + strikethrough style if `stock_quantity === 0`. Selected size highlighted in red.
- Quantity selector — `-` button, number display, `+` button. Min: 1. Max: the selected variant's `stock_quantity`. Disable `+` when at max.
- `"Add to Cart"` button — disabled if no size selected. On click: add item to cart, show brief `"Added!"` feedback on the button for 1.5 seconds, then revert to `"Add to Cart"`.

**Size sort order utility:**
```typescript
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size']

function sortSizes(variants: ProductVariant[]): ProductVariant[] {
  return [...variants].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.size)
    const bi = SIZE_ORDER.indexOf(b.size)
    if (ai === -1 && bi === -1) return a.size.localeCompare(b.size)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}
```

**Add to cart logic:**
```typescript
function addToCart(product: Product, variant: ProductVariant, quantity: number) {
  setCartItems(prev => {
    const existing = prev.find(item => item.variantId === variant.id)
    if (existing) {
      return prev.map(item =>
        item.variantId === variant.id
          ? { ...item, quantity: Math.min(item.quantity + quantity, variant.stock_quantity) }
          : item
      )
    }
    return [...prev, {
      variantId: variant.id,
      productId: product.id,
      productName: product.name,
      productImage: product.image_url,
      size: variant.size,
      price: product.price,
      quantity,
    }]
  })
}
```

### Cart Button (Floating)

A sticky cart button in the top-right corner (or fixed bottom-right on mobile) showing:
- Cart icon (Lucide `ShoppingCart`)
- Item count badge in red

Clicking opens the cart drawer. Hide if cart is empty.

### Cart Drawer

A slide-in drawer from the right side. On mobile it takes full width. On desktop it is 400px wide.

**Layout inside drawer:**
- Header: `"Your Cart"` + close button (X)
- Item list: each item shows image thumbnail, name, size, price × quantity, and a remove button
- Quantity controls per item: `-` and `+` buttons inline
- Subtotal row
- Shipping row: `"Shipping: $[SHIPPING_RATE]"` — if rate is 0, show `"Shipping: Free"`
- Total row (bold)
- `"Checkout with PayPal"` button — full width, gold PayPal button style
- `"Continue Shopping"` text link — closes drawer

**Totals calculation:**
```typescript
const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
const shipping = cartItems.length > 0 ? SHIPPING_RATE : 0
const total = subtotal + shipping
```

### Checkout Flow

When the customer clicks `"Checkout with PayPal"`, show a shipping form above the PayPal button inside the drawer:

**Shipping form fields:**
- Full name (required)
- Email (required) — used for order confirmation
- Address (required)
- City (required)
- State (required) — US state dropdown
- Zip (required)

**Note:** Pre-populate from logged-in user's profile if available. Check auth state:
```typescript
const { data: { user } } = await supabase.auth.getUser()
```

If logged in, fetch their profile and pre-fill the form. If guest, leave blank.

Only show the PayPal button after all required shipping fields are filled. Use a simple `isShippingValid` boolean derived from form state — do not submit the form, just validate client-side before showing PayPal.

**PayPal button:**
```typescript
<PayPalScriptProvider options={{
  clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID!,
  currency: 'USD',
}}>
  <PayPalButtons
    style={{ layout: 'vertical', color: 'gold', shape: 'rect' }}
    createOrder={(data, actions) => {
      return actions.order.create({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            value: total.toFixed(2),
            currency_code: 'USD',
            breakdown: {
              item_total: { value: subtotal.toFixed(2), currency_code: 'USD' },
              shipping: { value: shipping.toFixed(2), currency_code: 'USD' },
            },
          },
          items: cartItems.map(item => ({
            name: `${item.productName} (${item.size})`,
            unit_amount: { value: item.price.toFixed(2), currency_code: 'USD' },
            quantity: item.quantity.toString(),
          })),
        }],
      })
    }}
    onApprove={async (data, actions) => {
      const order = await actions.order!.capture()
      const response = await fetch('/api/orders/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paypalOrderId: order.id,
          paypalTransactionId: order.purchase_units[0].payments?.captures?.[0]?.id,
          cartItems,
          shipping: shippingForm,
          subtotal,
          shippingCost: shipping,
          total,
        }),
      })
      const result = await response.json()
      if (result.success) {
        clearCart()
        setCartItems([])
        setCheckoutState('success')
      } else {
        setCheckoutState('error')
      }
    }}
    onError={() => setCheckoutState('error')}
  />
</PayPalScriptProvider>
```

**Checkout states** (`checkoutState`):
- `'cart'` — default, showing cart contents
- `'shipping'` — showing shipping form + PayPal button
- `'success'` — order confirmed
- `'error'` — something went wrong

**Success state in drawer:**
- Green checkmark
- `"Order confirmed!"`
- `"A confirmation email has been sent to [email]."`
- `"Continue Shopping"` button — closes drawer

**Error state in drawer:**
- `"Something went wrong. Please try again or contact us at info@superherocpr.com"`
- `"Try Again"` button — resets to `'shipping'` state

---

## API Route — Confirm Order

**File:** `app/api/orders/confirm/route.ts`

This route must:
1. Validate required fields
2. Re-check stock availability for all items (first-come-first-served)
3. Create `orders` record
4. Create all `order_items` records
5. Decrement `stock_quantity` on each `product_variants` record
6. Send order confirmation email to customer
7. Send order notification email to business

```typescript
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const SHIPPING_RATE = parseFloat(process.env.NEXT_PUBLIC_SHIPPING_RATE ?? '0')

export async function POST(request: Request) {
  const supabase = createClient()
  const body = await request.json()

  const {
    paypalTransactionId,
    cartItems,
    shipping,
    subtotal,
    shippingCost,
    total,
  } = body

  // Step 1: Validate
  if (!paypalTransactionId || !cartItems?.length || !shipping?.email) {
    return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 })
  }

  // Step 2: Re-check stock for all items
  for (const item of cartItems) {
    const { data: variant } = await supabase
      .from('product_variants')
      .select('stock_quantity')
      .eq('id', item.variantId)
      .single()

    if (!variant || variant.stock_quantity < item.quantity) {
      return Response.json(
        { success: false, error: `${item.productName} (${item.size}) is no longer available in the requested quantity.` },
        { status: 409 }
      )
    }
  }

  // Step 3: Resolve customer_id if logged in (optional)
  const { data: { user } } = await supabase.auth.getUser()
  const customerId = user?.id ?? null

  // Step 4: Create order record
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      customer_id: customerId,
      status: 'paid',
      total_amount: total,
      paypal_transaction_id: paypalTransactionId,
      shipping_name: shipping.name,
      shipping_address: shipping.address,
      shipping_city: shipping.city,
      shipping_state: shipping.state,
      shipping_zip: shipping.zip,
    })
    .select('id')
    .single()

  if (orderError || !order) {
    return Response.json({ success: false, error: 'Failed to create order' }, { status: 500 })
  }

  // Step 5: Create order items + decrement stock
  for (const item of cartItems) {
    await supabase.from('order_items').insert({
      order_id: order.id,
      variant_id: item.variantId,
      quantity: item.quantity,
      price_at_purchase: item.price,
    })

    await supabase.rpc('decrement_stock', {
      variant_id: item.variantId,
      amount: item.quantity,
    })
  }

  // Step 6: Send confirmation email to customer
  const itemListHtml = cartItems.map((item: CartItem) =>
    `<tr>
      <td>${item.productName} (${item.size})</td>
      <td>x${item.quantity}</td>
      <td>$${(item.price * item.quantity).toFixed(2)}</td>
    </tr>`
  ).join('')

  await resend.emails.send({
    from: 'Superhero CPR <noreply@superherocpr.com>',
    to: shipping.email,
    subject: 'Your Superhero CPR Order is Confirmed!',
    html: `
      <h1>Order Confirmed!</h1>
      <p>Thanks for your order. Here's a summary:</p>
      <table>
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
        <tbody>${itemListHtml}</tbody>
        <tfoot>
          <tr><td colspan="2">Subtotal</td><td>$${subtotal.toFixed(2)}</td></tr>
          <tr><td colspan="2">Shipping</td><td>${shippingCost > 0 ? '$' + shippingCost.toFixed(2) : 'Free'}</td></tr>
          <tr><td colspan="2"><strong>Total</strong></td><td><strong>$${total.toFixed(2)}</strong></td></tr>
        </tfoot>
      </table>
      <p><strong>Shipping to:</strong><br>
        ${shipping.name}<br>
        ${shipping.address}<br>
        ${shipping.city}, ${shipping.state} ${shipping.zip}
      </p>
      <p>Transaction ID: ${paypalTransactionId}</p>
      <p>Questions? Contact us at info@superherocpr.com or (813) 966-3969.</p>
      <p>— The Superhero CPR Team</p>
    `,
  })

  // Step 7: Notify business
  await resend.emails.send({
    from: 'Superhero CPR Website <noreply@superherocpr.com>',
    to: 'info@superherocpr.com',
    subject: `New Merch Order — $${total.toFixed(2)}`,
    html: `
      <h2>New merch order received</h2>
      <table>
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
        <tbody>${itemListHtml}</tbody>
      </table>
      <p><strong>Ship to:</strong><br>
        ${shipping.name}<br>
        ${shipping.address}<br>
        ${shipping.city}, ${shipping.state} ${shipping.zip}<br>
        ${shipping.email}
      </p>
      <p><strong>Total:</strong> $${total.toFixed(2)}</p>
      <p><strong>PayPal Transaction:</strong> ${paypalTransactionId}</p>
    `,
  })

  return Response.json({ success: true, orderId: order.id })
}
```

---

## Supabase RPC — `decrement_stock`

Stock decrement must be atomic to prevent race conditions. Create this Postgres function in Supabase:

```sql
create or replace function decrement_stock(variant_id uuid, amount int)
returns void as $$
  update product_variants
  set stock_quantity = greatest(stock_quantity - amount, 0)
  where id = variant_id;
$$ language sql;
```

Add this to the Supabase migrations. Leave a comment in the API route:
`// Uses Supabase RPC for atomic stock decrement — see supabase/migrations/decrement_stock.sql`

---

## Page Assembly

**File:** `app/(public)/merch/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server'
import MerchHeroSection from './_components/MerchHeroSection'
import MerchClient from './_components/MerchClient'
import type { Product } from '@/types/merch'

export const metadata = {
  title: 'Merch | Superhero CPR',
  description: 'Official Superhero CPR merchandise. Rep the mission and spread CPR awareness.',
}

export default async function MerchPage() {
  const supabase = createClient()

  const { data: products } = await supabase
    .from('products')
    .select(`
      id, name, description, price, image_url,
      product_variants ( id, size, stock_quantity )
    `)
    .eq('active', true)
    .order('name')

  return (
    <main>
      <MerchHeroSection />
      <MerchClient products={(products ?? []) as Product[]} />
    </main>
  )
}
```

---

## Responsive Breakpoints

- Mobile (< `md`): 1 column product grid. Cart drawer is full width.
- Tablet (`md`): 2 column product grid.
- Desktop (`lg`+): 3 column product grid. Cart drawer is 400px wide.

Cart drawer must be usable at 375px — all form fields full width, PayPal button full width.

---

## Typography & Brand

- **Primary color:** Red — `red-600` / `red-700`
- **Active size pill:** `bg-red-600 text-white`
- **Inactive size pill:** `bg-white border border-gray-200 text-gray-700`
- **Disabled/out-of-stock size:** `bg-gray-100 text-gray-400 line-through cursor-not-allowed`
- **Cart badge:** `bg-red-600 text-white text-xs rounded-full`
- **Price formatting:** Always use `toLocaleString('en-US', { style: 'currency', currency: 'USD' })`

---

## Accessibility Requirements

- Size selector pills must be `<button>` elements with `aria-pressed` for selected state
- Out-of-stock sizes must have `disabled` attribute and `aria-label="[size] — out of stock"`
- Quantity `+` and `-` buttons must have `aria-label="Increase quantity"` / `"Decrease quantity"`
- Cart drawer must trap focus when open — use `focus-trap` or implement manually
- Cart drawer must be closeable with the Escape key
- Cart drawer must have `role="dialog"` and `aria-label="Shopping cart"`
- All images must have descriptive `alt` attributes

---

## What NOT to Do

- Do not fetch data inside `MerchClient` — all product data comes via props
- Do not skip the stock re-check in the API route
- Do not decrement stock directly with a raw UPDATE — use the `decrement_stock` RPC for atomicity
- Do not use `any` TypeScript types — use interfaces from `types/merch.ts`
- Do not crash if `image_url` is null — always render a placeholder div
- Do not show the PayPal button before the shipping form is valid
- Do not skip order notification email to the business
- Do not use inline styles — Tailwind only
- Do not put all logic in one file

---

## Definition of Done

The page is complete when:
- [ ] Product catalog renders correctly with images, sizes, and prices
- [ ] Out-of-stock sizes are disabled with strikethrough style
- [ ] Adding items to cart works, cart persists in localStorage on page reload
- [ ] Cart drawer opens/closes correctly, shows correct items and totals
- [ ] Shipping cost shows correctly — free if rate is 0
- [ ] Shipping form validates before showing PayPal button
- [ ] Logged-in users have shipping form pre-populated from profile
- [ ] PayPal checkout fires correctly with correct total
- [ ] API route re-checks stock before creating order
- [ ] Order record and order items created in DB after payment
- [ ] Stock decremented atomically via RPC after payment
- [ ] Customer receives order confirmation email
- [ ] Business receives order notification email at info@superherocpr.com
- [ ] Cart cleared from localStorage after successful order
- [ ] Success state shown in drawer after order confirmed
- [ ] Error state shown if API call fails
- [ ] Page fully responsive from 375px to 1440px
- [ ] Cart drawer accessible — focus trap, Escape key, role and aria attributes
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export for SEO
