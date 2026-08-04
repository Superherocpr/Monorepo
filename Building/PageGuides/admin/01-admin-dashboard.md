# Admin Dashboard Build Guide
**Route:** `/admin`
**File:** `app/(admin)/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/admin` dashboard for **Superhero CPR**. This is the first page every staff member sees after logging in. The dashboard is role-aware — each role sees a different set of widgets. The admin area has its own distinct visual style: clean, well-spaced, simple, and functional. Heavy lifting is done in the code and data layer — not through complex UI.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

---

## Admin Visual Style

The admin area has its own design language distinct from the public site:
- Background: `bg-gray-50` page background
- Cards: white bg, `border border-gray-200`, `rounded-lg`, generous padding (`p-6`)
- Typography: clean, no decorative elements
- Spacing: generous — content breathes, nothing feels cramped
- Colors: minimal — gray scale with red accents for actions and alerts
- No decorative illustrations, no gradients, no shadows
- Data is the hero — UI gets out of the way

All admin pages share this style. Build it into the admin layout, not per-page.

---

## Admin Layout

**File:** `app/(admin)/layout.tsx`

The admin layout wraps all admin pages and provides:
- Auth guard — redirect non-staff to `/` if not logged in or not a staff role
- Archived account check — redirect archived accounts
- Role detection — passes role to sidebar
- Impersonation state — super admin "View As Instructor" mode
- Sidebar navigation
- Top bar with user name, role badge, and sign out button

```typescript
const staffRoles = ['instructor', 'manager', 'super_admin', 'inspector']

const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/book/signin')

const { data: profile } = await supabase
  .from('profiles')
  .select('first_name, last_name, role, archived')
  .eq('id', user.id)
  .single()

if (!profile || profile.archived || !staffRoles.includes(profile.role)) {
  redirect('/')
}
```

**Impersonation:** Super admin can select an instructor from a dropdown to view the admin as that instructor. Store `impersonating_instructor_id` in session/cookie. All data queries in instructor-specific pages check this value. A persistent red banner shows: `"Viewing as [Instructor Name] — Exit"`.

---

## Sidebar Navigation

**File:** `app/(admin)/_components/AdminSidebar.tsx`

Sidebar items are filtered by role. Build a config-driven nav:

```typescript
const navItems = [
  { label: 'Dashboard', href: '/admin', roles: ['instructor', 'manager', 'super_admin', 'inspector'] },
  { label: 'My Schedule', href: '/admin/sessions', roles: ['instructor'] },
  { label: 'My Classes', href: '/admin/sessions', roles: ['instructor'] },
  { label: 'Grading', href: '/admin/sessions', roles: ['instructor'] },
  { label: 'Invoices', href: '/admin/invoices', roles: ['instructor', 'manager', 'super_admin'] },
  { label: 'Rollcall', href: '/rollcall', roles: ['instructor'] },
  { label: 'Classes', href: '/admin/sessions', roles: ['manager', 'super_admin'] },
  { label: 'Approvals', href: '/admin/sessions/approvals', roles: ['manager', 'super_admin'] },
  { label: 'Customers', href: '/admin/customers', roles: ['manager', 'super_admin'] },
  { label: 'Payments', href: '/admin/payments', roles: ['manager', 'super_admin'] },
  { label: 'Contact', href: '/admin/contact', roles: ['manager', 'super_admin'] },
  { label: 'Locations', href: '/admin/locations', roles: ['manager', 'super_admin'] },
  { label: 'Certifications', href: '/admin/certifications', roles: ['super_admin'] },
  { label: 'Merch', href: '/admin/merch', roles: ['super_admin'] },
  { label: 'Orders', href: '/admin/orders', roles: ['super_admin'] },
  { label: 'Staff', href: '/admin/staff', roles: ['super_admin'] },
  { label: 'Settings', href: '/admin/settings', roles: ['super_admin'] },
  { label: 'Archived Accounts', href: '/admin/archived', roles: ['super_admin'] },
  { label: 'Analytics', href: '/admin/analytics', roles: ['super_admin'] },
]
```

- Desktop: fixed left sidebar, 240px wide
- Mobile: hidden by default, hamburger menu toggles it
- Active link: red left border accent + red text
- Inactive link: gray text, hover gray bg

**View As Instructor** — super admin only. Dropdown at the bottom of the sidebar listing all active instructors. Selecting one sets impersonation mode. An Exit button clears it.

---

## Architecture

Fully server-rendered. All data fetched in parallel using `Promise.all`. Role detected server-side, appropriate widgets passed to the page.

---

## Instructor Dashboard Widgets

### Widget 1 — Today's Classes
```typescript
const { data: todaySessions } = await supabase
  .from('class_sessions')
  .select(`
    id, starts_at, ends_at, status, approval_status,
    class_types ( name ),
    locations ( name )
  `)
  .eq('instructor_id', instructorId)
  .eq('approval_status', 'approved')
  .gte('starts_at', startOfToday)
  .lte('starts_at', endOfToday)
  .order('starts_at')
```

Shows: class name, time, location, status badge. Link to session detail. If none: `"No classes today."` Hide widget entirely if empty.

### Widget 2 — Pending Grades
```typescript
// Sessions that are completed but have roster_records with null grades
```

Shows: session name, date, count of ungraded students. Link to grading tool. Hide if none.

### Widget 3 — Pending Invoices
```typescript
const { data: pendingInvoices } = await supabase
  .from('invoices')
  .select('id, recipient_name, total_amount, created_at, class_sessions(starts_at, class_types(name))')
  .eq('instructor_id', instructorId)
  .eq('status', 'sent')
  .order('created_at', { ascending: false })
```

Shows: recipient, amount, class, days since sent. Link to invoice. Hide if none.

### Widget 4 — Daily Rollcall Code
Always visible for instructors. Large, prominent display:
```
Today's Class Code: 4821
```
Pulled from `profiles.daily_access_code`. Refreshes daily at midnight. Students enter this at `/rollcall` to register for the instructor's class.

### Widget 5 — Open Opportunities
Cancelled sessions with no instructor, open for any instructor to claim first-come-first-serve. Component: `OpenOpportunitiesWidget.tsx`.
```typescript
const { data: openOpportunities } = await supabase
  .from('class_sessions')
  .select('id, starts_at, class_types ( name ), locations ( name, city )')
  .eq('status', 'cancelled')
  .is('instructor_id', null)
  .order('starts_at')
```

Shows: class name, date, original location, amber "Open" badge. Each row links to `/admin/sessions/[id]`, where the instructor reviews the session and claims it via the open-opportunity banner. Hide if none. Because this is queried fresh on every server render, a claimed session disappears from everyone's list on their next page load — no realtime sync.

---

## Manager Dashboard Widgets

### Widget 1 — Pending Approvals
Count of sessions with `approval_status = 'pending_approval'`. Displays as a number badge with a link to `/admin/sessions/approvals`. Does not show inline approve/reject — just the count and link.

### Widget 2 — Today's Classes
All approved sessions happening today across all instructors. Shows instructor name, class type, time, location, student count vs capacity.

### Widget 3 — Recent Bookings
Last 5 bookings across all sessions. Shows customer name, class, date, booking source badge.

### Widget 4 — Unanswered Contact Submissions
Count of `contact_submissions` where `replied = false`. Link to `/admin/contact`. Hide if zero.

### Widget 5 — Low Stock Alert
Products where any variant's `stock_quantity <= products.low_stock_threshold`. Shows product name, variant size, current stock, threshold. Link to `/admin/merch`. Hide if none.

---

## Super Admin Dashboard Widgets

Everything the manager sees, plus:

### Widget 6 — Quick Stats Strip
Four metric cards in a row:
- Total customers (profiles where role = customer, not archived)
- Classes this month (approved sessions this calendar month)
- Online booking revenue this month
- Invoice revenue this month (separate from online — shown side by side)

### Widget 7 — Recent Activity Feed
Last 10 actions across the system — bookings, payments, invoices, new customers. Each item shows what happened, who, when. Pulled by combining recent records from bookings, payments, invoices tables ordered by created_at desc.

---

## Page Assembly

```typescript
export default async function AdminDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await fetchProfile(supabase, user.id)

  if (profile.role === 'instructor') {
    const [todaySessions, pendingGrades, pendingInvoices, openOpportunities] = await Promise.all([...])
    return <InstructorDashboard ... />
  }

  if (profile.role === 'manager') {
    const [pendingApprovals, todaySessions, recentBookings, unansweredContact, lowStock] = await Promise.all([...])
    return <ManagerDashboard ... />
  }

  if (profile.role === 'super_admin') {
    const [...all manager data, quickStats, recentActivity] = await Promise.all([...])
    return <SuperAdminDashboard ... />
  }

  // Inspector placeholder
  return <InspectorDashboard />
}
```

---

## Responsive Breakpoints

- Mobile: Single column. Sidebar hidden behind hamburger.
- Desktop (`lg`+): Fixed sidebar + main content area.

Widget grid: 1 col mobile, 2 col desktop (`lg:grid-cols-2`). Quick stats strip: 2 col mobile, 4 col desktop.

---

## Accessibility

- Sidebar nav links must have `aria-current="page"` on active link
- Role badge in top bar must be visible text — not color alone
- Daily code widget must have `aria-label="Today's rollcall code"`
- All metric cards must have descriptive labels above the number

---

## What NOT to Do

- Do not show the same widgets to all roles — role-specific rendering is required
- Do not use client components — fully server-rendered
- Do not fetch data sequentially — use `Promise.all`
- Do not put approval actions on the dashboard — link to the approvals page
- Do not use `any` TypeScript types
- Do not use inline styles — Tailwind only

---

## Definition of Done

- [ ] Auth guard redirects non-staff correctly
- [ ] Sidebar shows correct items per role
- [ ] Instructor sees: today's classes, pending grades, pending invoices, daily code, open opportunities
- [ ] Manager sees: pending approvals count, today's classes, recent bookings, contact alert, low stock
- [ ] Super admin sees all manager widgets plus quick stats and activity feed
- [ ] All widgets hide when empty (except daily code and quick stats)
- [ ] Impersonation mode banner visible when super admin is viewing as instructor
- [ ] View As Instructor dropdown works correctly
- [ ] Page fully responsive from 375px to 1440px
- [ ] No TypeScript errors
- [ ] No ESLint errors
