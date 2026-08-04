# Admin Class Sessions Build Guide
**Route:** `/admin/sessions`
**File:** `app/(admin)/sessions/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/admin/sessions` class sessions list page for **Superhero CPR**. This page shows all class sessions, grouped by month, ordered nearest to furthest. Instructors see only their own sessions. Managers and super admins see all sessions across all instructors.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

This page is protected by the admin layout auth guard.

---

## Architecture

Hybrid — server component fetches data, passes to a client component for filtering. Filtering is client-side since session volume is manageable.

---

## Data Fetching

```typescript
const supabase = createClient()
const { data: { user } } = await supabase.auth.getUser()
const profile = await fetchAdminProfile(supabase, user.id)

// Instructors only see their own sessions
// Managers and super admins see all sessions
const query = supabase
  .from('class_sessions')
  .select(`
    id, starts_at, ends_at, status, approval_status,
    rejection_reason, max_capacity, created_at,
    class_types ( id, name ),
    profiles ( id, first_name, last_name ),
    locations ( name ),
    bookings ( id, cancelled )
  `)
  .order('starts_at', { ascending: true })

if (profile.role === 'instructor') {
  query.eq('instructor_id', profile.id)
}

const { data: sessions } = await query

// Compute spots remaining per session
const sessionsWithMeta = (sessions ?? []).map(session => ({
  ...session,
  spotsRemaining: session.max_capacity - (session.bookings ?? []).filter(b => !b.cancelled).length,
}))

// Fetch instructors list for filter (manager/super admin only)
const instructors = profile.role !== 'instructor'
  ? await fetchInstructors(supabase)
  : []
```

---

## Create Session Button

Visible to all staff roles. Opens `/admin/sessions/new`.

For instructors: `"Create New Class"`
For managers/super admins: `"Create New Class"` — can assign to any instructor

---

## Filter Bar (Client-Side)

**Filters:**
- Date range — From / To date inputs
- Class type — dropdown of all class types
- Approval status — All / Pending / Approved / Rejected
- Instructor — dropdown (manager/super admin only, hidden for instructors)

**Default filter:** Show upcoming sessions only (starts_at >= today). Toggle to show past sessions.

All filters are client-side. No re-fetching on filter change.

---

## Session List — Grouped by Month

Group sessions by month after filtering:

```typescript
const grouped = sessions.reduce<Record<string, Session[]>>((acc, session) => {
  const key = new Date(session.starts_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
  if (!acc[key]) acc[key] = []
  acc[key].push(session)
  return acc
}, {})
```

Each month group has a sticky section header.

---

## Session Card

Each session card shows:
- Class type name — bold (`<h3>`)
- Date and time — formatted
- Location name
- Instructor name — shown for manager/super admin views
- Spots: `"[n] / [max] students booked"`
- Approval status badge:
  - `pending_approval` → amber `"Awaiting Approval"`
  - `approved` → green `"Approved"`
  - `rejected` → red `"Rejected"`
- Session status badge:
  - `scheduled` → blue
  - `in_progress` → amber
  - `completed` → green
  - `cancelled` → red

**Rejected session — instructor view:**
Show rejection reason inline below the badges:
```
"Rejection reason: [reason]"
```
Below that: `"Please review and resubmit →"` — link to session detail

**Actions:**
- `"View"` button → `/admin/sessions/[id]` — all roles
- `"Grade"` button → `/admin/sessions/[id]/grades` — instructor (own completed sessions) + super admin

---

## Empty State

If no sessions match filters:
- Icon: `CalendarX` from Lucide
- Text: `"No sessions found. Try adjusting your filters."`
- If no sessions at all: `"No classes yet. Create your first class to get started."` + Create button

---

## Page Assembly

```typescript
import SessionsClient from './_components/SessionsClient'

export default async function SessionsPage() {
  // fetch data server-side
  return (
    <main>
      <SessionsClient
        sessions={sessionsWithMeta}
        instructors={instructors}
        userRole={profile.role}
        userId={profile.id}
      />
    </main>
  )
}
```

---

## Responsive

- Mobile: Single column cards
- Desktop: Cards with more breathing room, filter bar inline at top

---

## What NOT to Do

- Do not show all sessions to instructors — filter by instructor_id
- Do not fetch data in the client component
- Do not use `any` TypeScript types
- Do not paginate — load all and filter client-side

---

## Definition of Done

- [ ] Instructors see only their own sessions
- [ ] Managers/super admins see all sessions with instructor name
- [ ] Sessions grouped by month, ordered nearest to furthest
- [ ] All filters work client-side
- [ ] Rejected sessions show reason and resubmit link for instructors
- [ ] Approval and status badges correct
- [ ] Create button visible to all roles
- [ ] Empty state renders correctly
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
