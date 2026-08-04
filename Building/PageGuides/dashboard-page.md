# Customer Dashboard Build Guide
**Route:** `/dashboard`
**File:** `app/(public)/dashboard/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/dashboard` page for **Superhero CPR**. This is the customer's home base after logging in — a personalized overview of their upcoming classes, certifications, and recent orders.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

---

## Auth Guard

This page requires authentication. If the user is not logged in, redirect to `/book/signin`. If the user's account has been archived (soft-deleted), sign them out and redirect to the home page.

In `app/(public)/dashboard/layout.tsx`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/book/signin?redirect=/dashboard')
  }

  // Check if the customer's account has been archived
  // Archived accounts should not be able to access the portal
  // even if they still have an active Supabase auth session
  const { data: profile } = await supabase
    .from('profiles')
    .select('archived')
    .eq('id', user.id)
    .single()

  if (profile?.archived) {
    await supabase.auth.signOut()
    redirect('/?accountDeleted=true')
  }

  return <>{children}</>
}
```

This layout applies to all `/dashboard/*` routes — build it once, it protects every customer portal page.

---

## Architecture

This page is **fully server-rendered**. All data is fetched in `page.tsx` before the page is sent to the browser. No client components, no loading states, no skeleton loaders — the page arrives complete.

All data fetching is parallel using `Promise.all` to keep load time fast:

```typescript
const [profile, upcomingBookings, certifications, recentOrder] = await Promise.all([
  fetchProfile(supabase, user.id),
  fetchUpcomingBookings(supabase, user.id),
  fetchCertifications(supabase, user.id),
  fetchRecentOrder(supabase, user.id),
])
```

---

## Data Fetching

Define these fetch functions at the bottom of `page.tsx` or in a separate `lib/dashboard-data.ts` file.

### `fetchProfile`
```typescript
async function fetchProfile(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name, email')
    .eq('id', userId)
    .single()
  return data
}
```

### `fetchUpcomingBookings`
```typescript
async function fetchUpcomingBookings(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from('bookings')
    .select(`
      id,
      class_sessions (
        starts_at,
        ends_at,
        class_types ( name ),
        locations ( name, address, city, state )
      )
    `)
    .eq('customer_id', userId)
    .eq('cancelled', false)
    .gte('class_sessions.starts_at', new Date().toISOString())
    .order('class_sessions.starts_at', { ascending: true })
    .limit(2)
  return data ?? []
}
```

### `fetchCertifications`
```typescript
async function fetchCertifications(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from('certifications')
    .select(`
      id,
      issued_at,
      expires_at,
      cert_number,
      cert_types ( name )
    `)
    .eq('customer_id', userId)
    .order('expires_at', { ascending: true })
  return data ?? []
}
```

### `fetchRecentOrder`
```typescript
async function fetchRecentOrder(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from('orders')
    .select(`
      id,
      status,
      total_amount,
      tracking_number,
      created_at,
      order_items (
        quantity,
        price_at_purchase,
        product_variants (
          size,
          products ( name )
        )
      )
    `)
    .eq('customer_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return data ?? null
}
```

---

## Your Task

Build the complete `/dashboard` page. Each widget is its own component in `app/(public)/dashboard/_components/`.

---

## Section 1 — Welcome Header

**Component:** `DashboardWelcome.tsx`
**Type:** Server component

**Props:**
```typescript
interface DashboardWelcomeProps {
  firstName: string
}
```

**Layout:** Full-width section, white background, bottom border separator

**Content:**
- Greeting: `"Welcome back, [firstName]!"` — `<h1>`
- Subtext: `"Here's an overview of your classes and certifications."`

No interactivity. No data fetching — receives `firstName` as prop.

---

## Section 2 — Dashboard Grid

**Component:** `DashboardGrid.tsx`
**Type:** Server component

**Layout:** Responsive grid — 1 col mobile, 2 col desktop (`lg:grid-cols-2`). Widgets stack in this order:
1. Upcoming Classes (top left)
2. Certifications (top right)
3. Quick Actions (bottom left)
4. Recent Orders (bottom right)

If Upcoming Classes widget is hidden (no bookings), the grid adjusts naturally — do not leave a visual gap. Use CSS grid auto-placement.

---

## Widget 1 — Upcoming Classes

**Component:** `UpcomingClassesWidget.tsx`
**Type:** Server component

**Props:**
```typescript
interface UpcomingClassesWidgetProps {
  bookings: UpcomingBooking[]
}
```

**Visibility:** If `bookings.length === 0`, return `null`. Do not render the widget at all.

**Layout:** White card with border, padding, rounded corners

**Header:** `"Upcoming Classes"` (`<h2>`) + `"View all"` link → `/dashboard/bookings`

**Each booking shows:**
- Class name — bold
- Date — formatted: `"Tuesday, April 22, 2026"`
- Time — formatted: `"9:00 AM – 11:00 AM"`
- Location — `"[location.name] — [location.address], [location.city], [location.state]"`

**Separator** between bookings if more than one.

**TypeScript interface:**
```typescript
interface UpcomingBooking {
  id: string
  class_sessions: {
    starts_at: string
    ends_at: string
    class_types: { name: string }
    locations: { name: string; address: string; city: string; state: string }
  }
}
```

---

## Widget 2 — Certifications

**Component:** `CertificationsWidget.tsx`
**Type:** Server component

**Props:**
```typescript
interface CertificationsWidgetProps {
  certifications: Certification[]
}
```

**Visibility:** If `certifications.length === 0`, return `null`.

**Layout:** White card with border, padding, rounded corners

**Header:** `"My Certifications"` (`<h2>`) + `"View all"` link → `/dashboard/certifications`

**Each cert card shows:**
- Cert type name — bold
- Issued date — muted: `"Issued: April 1, 2024"`
- Expiry status — computed server-side:

```typescript
function getCertStatus(expiresAt: string): {
  label: string
  color: 'green' | 'amber' | 'red'
} {
  const now = new Date()
  const expiry = new Date(expiresAt)
  const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (daysRemaining < 0) {
    return { label: 'Expired', color: 'red' }
  }
  if (daysRemaining <= 90) {
    return { label: `Expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`, color: 'amber' }
  }
  return {
    label: `Expires ${new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    color: 'green'
  }
}
```

**Status display:**
- Green: `text-green-600` — normal expiry date shown
- Amber: `text-amber-600 font-medium` — `"Expires in X days"` with a warning icon (`AlertTriangle` from Lucide, 16px)
- Red: `text-red-600 font-medium` — `"Expired"` with an X circle icon (`XCircle` from Lucide, 16px)

**TypeScript interface:**
```typescript
interface Certification {
  id: string
  issued_at: string
  expires_at: string
  cert_number: string | null
  cert_types: { name: string }
}
```

---

## Widget 3 — Quick Actions

**Component:** `QuickActionsWidget.tsx`
**Type:** Server component

**Layout:** White card with border, padding, rounded corners

**Header:** `"Quick Actions"` (`<h2>`)

**Three action buttons — full width, stacked vertically:**

| Icon | Label | Link |
|---|---|---|
| `CalendarPlus` | Book a Class | `/book` |
| `Calendar` | View Schedule | `/schedule` |
| `ShoppingBag` | Shop Merch | `/merch` |

Each button is a Next.js `<Link>` styled as a full-width outlined button with icon on the left. On hover: red background, white text.

This widget is always visible — no hide condition.

---

## Widget 4 — Recent Order

**Component:** `RecentOrderWidget.tsx`
**Type:** Server component

**Props:**
```typescript
interface RecentOrderWidgetProps {
  order: RecentOrder | null
}
```

**Visibility:** If `order === null`, return `null`.

**Layout:** White card with border, padding, rounded corners

**Header:** `"Recent Order"` (`<h2>`) + `"View all orders"` link → `/dashboard/orders`

**Content:**
- Order date — `"Placed on [date]"`
- Status badge:
  - `pending` → gray badge
  - `paid` → blue badge
  - `shipped` → amber badge
  - `delivered` → green badge
  - `cancelled` → red badge
- Items summary — list of `"[product name] ([size]) x[qty]"` for each order item
- Total — `"Total: $[amount]"`
- Tracking number — if `tracking_number` is not null: `"Tracking: [tracking_number]"`

**TypeScript interface:**
```typescript
interface RecentOrder {
  id: string
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
  total_amount: number
  tracking_number: string | null
  created_at: string
  order_items: {
    quantity: number
    price_at_purchase: number
    product_variants: {
      size: string
      products: { name: string }
    }
  }[]
}
```

---

## Page Assembly

**File:** `app/(public)/dashboard/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardWelcome from './_components/DashboardWelcome'
import DashboardGrid from './_components/DashboardGrid'
import UpcomingClassesWidget from './_components/UpcomingClassesWidget'
import CertificationsWidget from './_components/CertificationsWidget'
import QuickActionsWidget from './_components/QuickActionsWidget'
import RecentOrderWidget from './_components/RecentOrderWidget'

export const metadata = {
  title: 'My Dashboard | Superhero CPR',
}

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/book/signin?redirect=/dashboard')

  const [profile, upcomingBookings, certifications, recentOrder] = await Promise.all([
    fetchProfile(supabase, user.id),
    fetchUpcomingBookings(supabase, user.id),
    fetchCertifications(supabase, user.id),
    fetchRecentOrder(supabase, user.id),
  ])

  if (!profile) redirect('/book/signin')

  return (
    <main>
      <DashboardWelcome firstName={profile.first_name} />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UpcomingClassesWidget bookings={upcomingBookings} />
          <CertificationsWidget certifications={certifications} />
          <QuickActionsWidget />
          <RecentOrderWidget order={recentOrder} />
        </div>
      </div>
    </main>
  )
}
```

---

## Dashboard Navigation

All customer portal pages share a dashboard navigation sidebar or top nav. Build this as `app/(public)/dashboard/_components/DashboardNav.tsx` and include it in the dashboard layout.

**Nav links:**
- Dashboard → `/dashboard`
- My Bookings → `/dashboard/bookings`
- My Certifications → `/dashboard/certifications`
- My Orders → `/dashboard/orders`
- Account Settings → `/dashboard/settings`

Active link highlighted in red. On mobile: horizontal scrolling tab bar at the top. On desktop: vertical sidebar on the left.

---

## Responsive Breakpoints

- Mobile (< `lg`): Single column. Widgets stack vertically. Nav is a horizontal tab bar.
- Desktop (`lg`+): Two-column grid. Nav is a vertical sidebar.

---

## Typography & Brand

- **Primary color:** Red — `red-600` / `red-700`
- **Widget cards:** White bg, `border border-gray-200`, `rounded-lg`, `p-6`
- **Widget headers:** `text-lg font-semibold text-gray-900` with a `"View all"` link in `text-red-600 text-sm`
- **Status badges:** Pill style, colored bg + text matching the status color family

---

## Accessibility Requirements

- `<h1>` is the welcome greeting — only one per page
- Widget headings are `<h2>`
- Status badges must convey meaning beyond color — include text label always
- Expiry warning icons must have `aria-label` e.g. `aria-label="Warning: certificate expiring soon"`
- All `<Link>` components must have descriptive text — avoid generic `"Click here"` or `"View"`

---

## What NOT to Do

- Do not use client components on this page — fully server-rendered
- Do not fetch data sequentially — use `Promise.all` for parallel fetching
- Do not render empty widgets — return `null` from widget components when data is empty
  (exception: QuickActionsWidget always renders)
- Do not use `any` TypeScript types — define explicit interfaces for all data shapes
- Do not hardcode the customer's name — always pull from the database
- Do not skip the archived check in the layout — archived customers must be signed out
- Do not use inline styles — Tailwind only

---

## Definition of Done

The page is complete when:
- [ ] Unauthenticated users are redirected to `/book/signin?redirect=/dashboard`
- [ ] Archived customers are signed out and redirected to `/?accountDeleted=true`
- [ ] Welcome header shows correct first name from DB
- [ ] Upcoming Classes widget renders correctly and hides when no bookings exist
- [ ] Certifications widget renders correctly and hides when no certs exist
- [ ] Cert expiry shows green / amber countdown / red expired correctly
- [ ] Quick Actions widget always renders with correct links
- [ ] Recent Order widget renders correctly and hides when no orders exist
- [ ] Order status type includes `'cancelled'` — all five statuses handled
- [ ] Order status badges show correct color per status
- [ ] Tracking number shown when available
- [ ] All data fetched in parallel with `Promise.all`
- [ ] Dashboard nav renders correctly on mobile (tab bar) and desktop (sidebar)
- [ ] Page fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export
