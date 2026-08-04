# Schedule Page Build Guide
**Route:** `/schedule`
**File:** `app/(public)/schedule/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/schedule` page for **Superhero CPR**. This is the primary booking discovery page — customers browse available class sessions, filter by class type or date, and click through to book. This is a high-interactivity page and requires careful separation of server and client responsibilities.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database (`@supabase/ssr` for server components)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

---

## Architecture Overview

This page uses a **server + client split**:

- The **page itself** (`page.tsx`) is a server component that fetches all upcoming sessions and class types from the DB and passes them as props to the client
- The **schedule client** (`ScheduleClient.tsx`) is a `"use client"` component that owns all filtering, display logic, and interactivity
- Filtering is **entirely client-side** — no refetching on filter change

This pattern keeps the initial data load fast (server-rendered) while enabling rich filtering without page reloads.

---

## Data Fetching — Server Side Only

All data fetching happens in `page.tsx`. Do not fetch data inside client components.

```typescript
// Fetch all upcoming APPROVED scheduled sessions
// CRITICAL: Must filter by approval_status = 'approved'
// Sessions pending approval or rejected must NOT appear on the public schedule
const { data: sessions } = await supabase
  .from('class_sessions')
  .select(`
    id,
    starts_at,
    ends_at,
    max_capacity,
    status,
    class_types (
      id,
      name,
      price,
      duration_minutes
    ),
    profiles (
      first_name,
      last_name
    ),
    locations (
      name,
      address,
      city,
      state,
      zip
    ),
    bookings (
      id,
      cancelled
    ),
    invoices (
      id,
      student_count,
      status
    )
  `)
  .eq('status', 'scheduled')
  .eq('approval_status', 'approved')
  .gte('starts_at', new Date().toISOString())
  .order('starts_at', { ascending: true })

// Fetch active class types for the filter bar
// Deactivated class types should not appear as filter options
const { data: classTypes } = await supabase
  .from('class_types')
  .select('id, name')
  .eq('active', true)
  .order('name')
```

**Compute spots remaining server-side before passing to client:**
```typescript
const sessionsWithAvailability = (sessions ?? []).map(session => {
  const activeBookings = (session.bookings ?? []).filter(b => !b.cancelled).length
  // Also subtract spots reserved by active invoices (unpaid invoices still hold spots)
  const invoiceStudents = (session.invoices ?? [])
    .filter(inv => inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + inv.student_count, 0)
  const spotsRemaining = session.max_capacity - activeBookings - invoiceStudents
  return {
    ...session,
    spotsRemaining,
    isFull: spotsRemaining <= 0,
  }
})
```

Pass `sessionsWithAvailability` and `classTypes` as props to `ScheduleClient`.

**Define TypeScript interfaces for these shapes** — do not use inferred Supabase types directly in the client component. Define explicit interfaces in `types/schedule.ts`:

```typescript
export interface ScheduleSession {
  id: string
  starts_at: string
  ends_at: string
  max_capacity: number
  status: string
  spotsRemaining: number
  isFull: boolean
  class_types: {
    id: string
    name: string
    price: number
    duration_minutes: number
  }
  profiles: {
    first_name: string
    last_name: string
  }
  locations: {
    name: string
    address: string
    city: string
    state: string
    zip: string
  }
}

export interface ClassTypeOption {
  id: string
  name: string
}
```

---

## Your Task

Build the complete `/schedule` page. Components live in `app/(public)/schedule/_components/`.

---

## Section 1 — Hero

**Component:** `ScheduleHeroSection.tsx`
**Type:** Server component

**Layout:** Full-width, centered, compact height

**Content — hardcoded:**
- Section label (small caps, red): `"Available Classes"`
- Headline: `"Find a Class Near You"`
- Subtext: `"Browse upcoming CPR certification sessions in the Tampa Bay area. Spots fill up fast — book early to secure your place."`

No data fetching.

---

## Section 2 — Schedule Client (Filter + List)

**Component:** `ScheduleClient.tsx`
**Type:** Client component (`"use client"`)

**Props:**
```typescript
interface ScheduleClientProps {
  sessions: ScheduleSession[]
  classTypes: ClassTypeOption[]
  initialClassFilter?: string | null
}
```

The `initialClassFilter` prop is passed from the page when a `?class=` query param is present. It should match a class type name slug (e.g. `"bls"`, `"cpr-aed"`). On mount, apply this filter automatically.

### Filter Bar

Render at the top of this component, above the session list.

**Two filters:**

1. **Class type filter** — a row of pill buttons, one per class type plus an "All Classes" default. The active pill is highlighted in red. On mobile, this row scrolls horizontally.

2. **Date filter** — a simple date range with two native `<input type="date">` fields labeled "From" and "To". Both are optional. If only "From" is set, show sessions from that date onward. If only "To" is set, show sessions up to that date.

**Clear filters button** — appears only when any filter is active. Resets all filters.

**Filter logic:**
```typescript
const filteredSessions = sessions.filter(session => {
  const sessionDate = new Date(session.starts_at)

  // Class type filter
  if (activeClassType) {
    const slug = session.class_types.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (slug !== activeClassType) return false
  }

  // Date range filter
  if (dateFrom && sessionDate < new Date(dateFrom)) return false
  if (dateTo && sessionDate > new Date(dateTo + 'T23:59:59')) return false

  return true
})
```

### Session List

Group filtered sessions by calendar date:

```typescript
const grouped = filteredSessions.reduce<Record<string, ScheduleSession[]>>((acc, session) => {
  const dateKey = new Date(session.starts_at).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  if (!acc[dateKey]) acc[dateKey] = []
  acc[dateKey].push(session)
  return acc
}, {})
```

Render each group with the date as a sticky section header (`<h2>`), followed by the session cards for that day.

### Session Card

Each session card displays:
- **Class name** — bold, large
- **Instructor** — `"Instructor: [first_name] [last_name]"`, muted text
- **Time** — formatted start and end time e.g. `"9:00 AM – 11:00 AM"`
- **Location** — full address block:
  ```
  [location.name]
  [location.address]
  [location.city], [location.state] [location.zip]
  ```
- **Price** — formatted as currency
- **Spots remaining** — shown as:
  - Green text if 5+ spots: `"[n] spots available"`
  - Amber text if 1-4 spots: `"Only [n] spots left"`
  - Red badge if full: `"Full"` — button disabled
- **Action:**
  - If not full: `"Book Now"` button → `/book?session=[session.id]`
  - If full: disabled `"Class Full"` button with red outline style

**Time formatting utility:**
```typescript
function formatTimeRange(startsAt: string, endsAt: string): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  return `${fmt(startsAt)} – ${fmt(endsAt)}`
}
```

### Empty State

When `filteredSessions.length === 0`, render:
- Icon: `Calendar` from Lucide React
- Heading: `"No classes found"`
- Body: `"No upcoming sessions match your filters. Try adjusting your search or contact us to arrange a private session."`
- Two links: `"Clear filters"` (resets filters) and `"Contact us"` → `/contact`

Render this inside the session list area — not as a separate component.

---

## Section 3 — Private Session CTA

**Component:** `PrivateSessionCta.tsx`
**Type:** Server component

**Layout:** Full-width, `bg-gray-50`, centered, compact

**Content — hardcoded:**
- Heading: `"Can't Find a Time That Works?"`
- Body: `"We offer private group sessions at your home, office, or facility. Contact us to arrange a session that fits your schedule."`
- CTA button: `"Contact Us"` → `/contact`

---

## Page Assembly

**File:** `app/(public)/schedule/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server'
import ScheduleHeroSection from './_components/ScheduleHeroSection'
import ScheduleClient from './_components/ScheduleClient'
import PrivateSessionCta from './_components/PrivateSessionCta'
import type { ScheduleSession, ClassTypeOption } from '@/types/schedule'

interface SchedulePageProps {
  searchParams: { class?: string }
}

export const metadata = {
  title: 'Class Schedule | Superhero CPR',
  description: 'Browse upcoming CPR certification classes in the Tampa Bay area. AHA-certified BLS, Heartsaver, CPR+AED, and Pediatric CPR sessions available.',
}

export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const supabase = createClient()

  // All data fetching here — see Data Fetching section above
  // ...

  return (
    <main>
      <ScheduleHeroSection />
      <ScheduleClient
        sessions={sessionsWithAvailability}
        classTypes={classTypes ?? []}
        initialClassFilter={searchParams.class ?? null}
      />
      <PrivateSessionCta />
    </main>
  )
}
```

---

## Query Param Pre-filtering

When the page loads with `?class=bls` (passed from the Classes page "View Schedule" links), `ScheduleClient` must apply that filter on initial render.

Use the `initialClassFilter` prop to set the initial `activeClassType` state:

```typescript
const [activeClassType, setActiveClassType] = useState<string | null>(
  initialClassFilter ?? null
)
```

Do not use `useEffect` to read the query param inside the client component — read it server-side in `page.tsx` via `searchParams` and pass it as a prop. This is cleaner and avoids hydration issues.

---

## Supabase Client Setup

```typescript
import { createClient } from '@/lib/supabase/server'

const supabase = createClient()
```

Server-side only in `page.tsx`. Do not fetch data in client components.

---

## Responsive Breakpoints

- `sm` — 640px
- `md` — 768px
- `lg` — 1024px

Session cards: single column on mobile, two columns on desktop (`lg:grid-cols-2`).
Filter pills row: horizontal scroll on mobile (`overflow-x-auto flex-nowrap`), wrapping on desktop.
Date filter inputs: stacked on mobile, inline on desktop.

---

## Typography & Brand

- **Primary color:** Red — `red-600` / `red-700`
- **Spots available:** `text-green-600`
- **Spots low:** `text-amber-600`
- **Full badge:** `bg-red-100 text-red-700`
- **Active filter pill:** `bg-red-600 text-white`
- **Inactive filter pill:** `bg-white border border-gray-200 text-gray-700 hover:border-red-300`
- **Date group header:** `text-gray-500 text-sm font-medium uppercase tracking-wide` — visually separates date groups

---

## Accessibility Requirements

- Filter pills must be `<button>` elements — not `<div>` or `<span>`
- Active filter pill must have `aria-pressed="true"`
- Disabled "Class Full" button must have `disabled` attribute AND `aria-disabled="true"`
- Date inputs must have associated `<label>` elements
- Session card "Book Now" buttons should include `aria-label` with the class name: `aria-label="Book ${session.class_types.name} on ${formattedDate}"`
- Date group headers are `<h2>` elements — they are the primary structural landmarks on this page
- Session card class names are `<h3>` elements

---

## What NOT to Do

- Do not fetch data inside `ScheduleClient` — all data comes via props from the server
- Do not use `useEffect` to read query params — read them server-side
- Do not use any filtering or date library — write the filter logic inline
- Do not use `any` TypeScript types — use the interfaces defined in `types/schedule.ts`
- Do not show past sessions — the DB query already filters them out, but add a defensive client-side check too
- Do not hide fully booked sessions — show them with a "Full" badge and disabled button
- Do not use inline styles — Tailwind only
- Do not put all logic in one file — hero, schedule client, and CTA are separate files
- **Do not show sessions without `approval_status = 'approved'`** — unapproved sessions must never appear publicly

---

## Definition of Done

The page is complete when:
- [ ] All sessions load and display correctly grouped by date
- [ ] Session query filters by BOTH `status = 'scheduled'` AND `approval_status = 'approved'`
- [ ] Class type filter pills only show active class types
- [ ] Class type filter pills work — active state highlighted, filters sessions correctly
- [ ] Date range filter works — both From and To are optional
- [ ] `?class=bls` query param pre-selects the correct filter on load
- [ ] Spots remaining accounts for both bookings AND active invoice student counts
- [ ] "Full" sessions show the Full badge and disabled button
- [ ] Spots remaining shows correct color (green / amber / red)
- [ ] Empty state renders when no sessions match filters
- [ ] Clear filters button appears only when filters are active and resets correctly
- [ ] Private session CTA renders below the list
- [ ] Page is fully responsive from 375px to 1440px
- [ ] Filter pills scroll horizontally on mobile
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export for SEO
- [ ] All buttons are accessible with correct aria attributes
