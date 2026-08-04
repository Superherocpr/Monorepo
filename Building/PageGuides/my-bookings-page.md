# My Bookings Page Build Guide
**Route:** `/dashboard/bookings`
**File:** `app/(public)/dashboard/bookings/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/dashboard/bookings` page for **Superhero CPR**. This page shows a logged-in customer all of their class bookings — upcoming, past, and cancelled. There are no interactive actions on this page — it is read-only. Customers who wish to cancel must call the business.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

This page is protected by the dashboard layout auth guard defined in `app/(public)/dashboard/layout.tsx`. No additional auth check is needed in this file.

---

## Architecture

This page is **fully server-rendered**. No client components. No interactive actions. All data fetched in parallel in `page.tsx`.

---

## Data Fetching

Fetch all bookings for the logged-in user in a single query, then split into three groups after fetch:

```typescript
const supabase = createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/book/signin?redirect=/dashboard/bookings')

const { data: bookings } = await supabase
  .from('bookings')
  .select(`
    id,
    cancelled,
    cancellation_note,
    booking_source,
    created_at,
    class_sessions (
      starts_at,
      ends_at,
      status,
      class_types ( name ),
      profiles ( first_name, last_name ),
      locations ( name, address, city, state, zip )
    ),
    payments (
      status,
      payment_type,
      amount
    )
  `)
  .eq('customer_id', user.id)
  .order('class_sessions.starts_at', { ascending: false })
```

**Split into three groups after fetching:**
```typescript
const now = new Date()

const upcoming = (bookings ?? []).filter(b =>
  !b.cancelled &&
  new Date(b.class_sessions.starts_at) >= now
)

const past = (bookings ?? []).filter(b =>
  !b.cancelled &&
  new Date(b.class_sessions.starts_at) < now
)

const cancelled = (bookings ?? []).filter(b => b.cancelled)

// Sort upcoming ascending (soonest first)
upcoming.sort((a, b) =>
  new Date(a.class_sessions.starts_at).getTime() -
  new Date(b.class_sessions.starts_at).getTime()
)

// Sort past descending (most recent first)
past.sort((a, b) =>
  new Date(b.class_sessions.starts_at).getTime() -
  new Date(a.class_sessions.starts_at).getTime()
)

// Sort cancelled descending
cancelled.sort((a, b) =>
  new Date(b.class_sessions.starts_at).getTime() -
  new Date(a.class_sessions.starts_at).getTime()
)
```

**Define TypeScript interface in `types/bookings.ts`:**
```typescript
export interface BookingRecord {
  id: string
  cancelled: boolean
  cancellation_note: string | null
  // All four booking sources must be included — bookings may come from online,
  // rollcall, invoice payment, or manual staff entry
  booking_source: 'online' | 'rollcall' | 'invoice' | 'manual'
  created_at: string
  class_sessions: {
    starts_at: string
    ends_at: string
    status: string
    class_types: { name: string }
    profiles: { first_name: string; last_name: string }
    locations: {
      name: string
      address: string
      city: string
      state: string
      zip: string
    }
  }
  payments: {
    status: string
    payment_type: string
    amount: number
  }[]
}
```

---

## Your Task

Build the complete `/dashboard/bookings` page. Components live in `app/(public)/dashboard/bookings/_components/`.

---

## Section 1 — Page Header

**Component:** `BookingsPageHeader.tsx`
**Type:** Server component

**Content — hardcoded:**
- `<h1>`: `"My Bookings"`
- Subtext: `"View all your upcoming and past CPR certification classes."`

---

## Section 2 — Upcoming Bookings

**Component:** `UpcomingBookingsList.tsx`
**Type:** Server component

**Props:**
```typescript
interface UpcomingBookingsListProps {
  bookings: BookingRecord[]
}
```

**Visibility:** If `bookings.length === 0`, render an empty state:
- Icon: `CalendarX` from Lucide React
- Heading: `"No upcoming classes"`
- Body: `"You don't have any upcoming bookings. Ready to get certified?"`
- CTA button: `"Book a Class"` → `/book`

**Section heading:** `"Upcoming Classes"` (`<h2>`)

**Each booking card shows:**
- Class name — bold, large
- **Booking source badge** — shown for non-online bookings only:
  - `'rollcall'` → gray badge `"Walk-in"`
  - `'invoice'` → gray badge `"Invoice"`
  - `'manual'` → gray badge `"Added by Staff"`
  - `'online'` → no badge (this is the normal case, no label needed)
- Date — `"Tuesday, April 22, 2026"`
- Time — `"9:00 AM – 11:00 AM"`
- Instructor — `"Instructor: [first_name] [last_name]"`
- Location — full block:
  ```
  [location.name]
  [location.address]
  [location.city], [location.state] [location.zip]
  ```
- Payment status — derived from `payments` array:
  - If payment with `status = 'completed'` exists: green badge `"Paid"` + amount
  - If payment with `status = 'pending'` exists: amber badge `"Payment Pending"`
  - If no payment records: gray badge `"Pay at Class"`

**Booking source badge helper:**
```typescript
function getBookingSourceBadge(source: BookingRecord['booking_source']): string | null {
  switch (source) {
    case 'rollcall': return 'Walk-in'
    case 'invoice': return 'Invoice'
    case 'manual': return 'Added by Staff'
    case 'online': return null // No badge for standard online booking
  }
}
```

**Payment status helper:**
```typescript
function getPaymentStatus(payments: BookingRecord['payments']): {
  label: string
  amount?: number
  color: 'green' | 'amber' | 'gray'
} {
  const completed = payments.find(p => p.status === 'completed')
  if (completed) return { label: 'Paid', amount: completed.amount, color: 'green' }
  const pending = payments.find(p => p.status === 'pending')
  if (pending) return { label: 'Payment Pending', color: 'amber' }
  return { label: 'Pay at Class', color: 'gray' }
}
```

**Cancellation notice** — shown once below ALL upcoming booking cards, not per card:
```
"Need to cancel? Please call us at (813) 966-3969 and we'll take care of it."
```
Style as a subtle info box — light blue background, `InfoIcon` from Lucide, muted text. Only render this notice if `bookings.length > 0`.

---

## Section 3 — Past Bookings

**Component:** `PastBookingsList.tsx`
**Type:** Server component

**Props:**
```typescript
interface PastBookingsListProps {
  bookings: BookingRecord[]
}
```

**Visibility:** If `bookings.length === 0`, return `null`. No empty state — just hide the section entirely.

**Section heading:** `"Past Classes"` (`<h2>`)

**Each past booking shows:**
- Class name — bold
- Date — `"April 1, 2024"` (no time needed for past)
- Instructor — `"Instructor: [first_name] [last_name]"`
- Location name only (no full address for past bookings)
- Session status badge:
  - `completed` → green `"Completed"`
  - `cancelled` → red `"Cancelled"` (session cancelled by business, not customer)
  - anything else → gray badge with the status text

**Note:** Do NOT show grade on past bookings — grades are internal staff information only.

**Layout:** Compact table-style list rather than full cards — past bookings are reference data, not primary content.

---

## Section 4 — Cancelled Bookings

**Component:** `CancelledBookingsList.tsx`
**Type:** Server component

**Props:**
```typescript
interface CancelledBookingsListProps {
  bookings: BookingRecord[]
}
```

**Visibility:** If `bookings.length === 0`, return `null`.

**Layout:** A collapsible `<details>` / `<summary>` element — collapsed by default.

```html
<details>
  <summary>Cancelled Bookings ({count})</summary>
  <!-- booking list here -->
</details>
```

**Each cancelled booking shows:**
- Class name
- Date
- Cancellation note if present — muted italic text

---

## Page Assembly

**File:** `app/(public)/dashboard/bookings/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import BookingsPageHeader from './_components/BookingsPageHeader'
import UpcomingBookingsList from './_components/UpcomingBookingsList'
import PastBookingsList from './_components/PastBookingsList'
import CancelledBookingsList from './_components/CancelledBookingsList'
import type { BookingRecord } from '@/types/bookings'

export const metadata = {
  title: 'My Bookings | Superhero CPR',
}

export default async function BookingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/book/signin?redirect=/dashboard/bookings')

  const { data: bookings } = await supabase
    .from('bookings')
    .select(`
      id, cancelled, cancellation_note, booking_source, created_at,
      class_sessions (
        starts_at, ends_at, status,
        class_types ( name ),
        profiles ( first_name, last_name ),
        locations ( name, address, city, state, zip )
      ),
      payments ( status, payment_type, amount )
    `)
    .eq('customer_id', user.id)
    .order('class_sessions.starts_at', { ascending: false })

  const now = new Date()
  const allBookings = (bookings ?? []) as BookingRecord[]

  const upcoming = allBookings
    .filter(b => !b.cancelled && new Date(b.class_sessions.starts_at) >= now)
    .sort((a, b) => new Date(a.class_sessions.starts_at).getTime() - new Date(b.class_sessions.starts_at).getTime())

  const past = allBookings
    .filter(b => !b.cancelled && new Date(b.class_sessions.starts_at) < now)
    .sort((a, b) => new Date(b.class_sessions.starts_at).getTime() - new Date(a.class_sessions.starts_at).getTime())

  const cancelled = allBookings
    .filter(b => b.cancelled)
    .sort((a, b) => new Date(b.class_sessions.starts_at).getTime() - new Date(a.class_sessions.starts_at).getTime())

  return (
    <main>
      <BookingsPageHeader />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        <UpcomingBookingsList bookings={upcoming} />
        <PastBookingsList bookings={past} />
        <CancelledBookingsList bookings={cancelled} />
      </div>
    </main>
  )
}
```

---

## Responsive Breakpoints

- Mobile: Single column. All cards full width.
- Desktop: Max width `4xl` centered.

---

## Typography & Brand

- **Section headings:** `text-xl font-semibold text-gray-900 mb-4`
- **Booking cards:** White bg, `border border-gray-200`, `rounded-lg`, `p-5`
- **Past bookings:** Compact list — `border border-gray-200 rounded-lg divide-y divide-gray-100`
- **Badges:** Pill style — `text-xs font-medium px-2.5 py-0.5 rounded-full`
- **Cancellation notice:** `bg-blue-50 border border-blue-100 rounded-lg p-4 text-blue-800 text-sm`

---

## Accessibility Requirements

- `<h1>` is the page title — only one
- Section headings are `<h2>`
- Booking card class names are `<h3>`
- Payment status badges must include text label — not color alone
- Cancellation notice phone number must be `<a href="tel:+18139663969">`

---

## What NOT to Do

- Do not add cancel buttons or any booking modification UI — read-only
- Do not show grades on any booking — internal staff only
- Do not use client components — fully server-rendered
- Do not fetch bookings in three separate queries — fetch once and split
- Do not use `any` TypeScript types — use `BookingRecord` from `types/bookings.ts`
- **Do not define `booking_source` as only `'online' | 'rollcall'`** — it must include `'invoice'` and `'manual'`
- Do not render empty section headings — hide sections when data is empty
- Do not use inline styles — Tailwind only

---

## Definition of Done

- [ ] Unauthenticated users redirect to sign in
- [ ] Upcoming bookings render with all fields — class, date, time, instructor, location, payment status
- [ ] `BookingRecord` interface includes all four booking sources: `online`, `rollcall`, `invoice`, `manual`
- [ ] No badge shown for `online` bookings
- [ ] `"Walk-in"` badge shown for rollcall bookings
- [ ] `"Invoice"` badge shown for invoice bookings
- [ ] `"Added by Staff"` badge shown for manual bookings
- [ ] Payment status correctly derived from payments array
- [ ] Cancellation notice shown below upcoming bookings when at least one exists
- [ ] Upcoming section shows empty state with Book a Class CTA when no upcoming bookings
- [ ] Past bookings render in compact list style — no grades shown
- [ ] Past section hidden when no past bookings
- [ ] Cancelled bookings section collapses with native HTML details/summary
- [ ] Cancelled section hidden when no cancelled bookings
- [ ] Page fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export
