# Admin Customer Management Build Guide
**Route:** `/admin/customers`
**File:** `app/(admin)/customers/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the customer management page for **Superhero CPR**. This page allows managers and super admins to search, browse, and manage all customer accounts — including archived ones. All customers are always visible. Search is server-side with debouncing. Managers can also create new customer accounts manually.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for account setup email

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Manager and Super Admin only.

---

## Architecture

This page is a **client component** wrapping a server-side search. The search input is debounced — after 300ms of no typing, a fetch call is made to an API route that queries the database.

`page.tsx` — server wrapper, initial data load (first 50 customers, no search term), passes to `CustomersClient.tsx`

`CustomersClient.tsx` — client component owning search state, filter state, and customer list

---

## Initial Data Fetch (Server)

```typescript
// Load first 50 customers on initial page load — includes archived
const { data: initialCustomers } = await supabase
  .from('profiles')
  .select(`
    id, first_name, last_name, email, phone, created_at, archived,
    bookings ( id, cancelled, class_sessions ( starts_at ) ),
    certifications ( id, expires_at )
  `)
  .eq('role', 'customer')
  .order('last_name', { ascending: true })
  .limit(50)
```

Compute per customer before passing to client:
```typescript
const customersWithMeta = (initialCustomers ?? []).map(customer => {
  const now = new Date()
  const activeBookings = customer.bookings.filter(b => !b.cancelled)
  const upcomingBookings = activeBookings.filter(b =>
    new Date(b.class_sessions.starts_at) >= now
  )
  const activeCerts = customer.certifications.filter(c =>
    new Date(c.expires_at) >= now
  )
  const expiringSoon = activeCerts.filter(c => {
    const days = Math.ceil((new Date(c.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return days <= 90
  })

  return {
    ...customer,
    upcomingBookingsCount: upcomingBookings.length,
    totalBookingsCount: activeBookings.length,
    activeCertsCount: activeCerts.length,
    hasExpiringSoon: expiringSoon.length > 0,
  }
})
```

---

## Search API Route

**File:** `app/api/customers/search/route.ts`

```typescript
export async function GET(request: Request) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') ?? ''
  const certFilter = searchParams.get('cert') ?? 'all'
  const bookingFilter = searchParams.get('booking') ?? 'all'

  // All customers always returned — active and archived
  let dbQuery = supabase
    .from('profiles')
    .select(`
      id, first_name, last_name, email, phone, created_at, archived,
      bookings ( id, cancelled, class_sessions ( starts_at ) ),
      certifications ( id, expires_at )
    `)
    .eq('role', 'customer')
    .order('last_name', { ascending: true })
    .limit(100)

  // Search by name, email, or phone
  if (query.length >= 2) {
    dbQuery = dbQuery.or(
      `first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`
    )
  }

  const { data: customers } = await dbQuery

  // Compute meta + apply cert/booking filters client-side after fetch
  // Return computed customer list
}
```

---

## Client Component — `CustomersClient.tsx`

### Search Bar
- Full-width text input with search icon
- Placeholder: `"Search by name, email, or phone..."`
- Debounced 300ms — calls `/api/customers/search?q=[term]` on change
- Loading indicator during search — muted `"Searching..."` text below input

### Filter Bar
Below the search bar:

**Cert status filter (pill buttons):**
- All
- Has active cert
- Expiring within 90 days
- Expired / no cert

**Booking activity filter (pill buttons):**
- All
- Has upcoming class
- Has past classes
- No bookings

**Account status filter (pill buttons):**
- All
- Active
- Archived

### Customer List

Table layout on desktop, card layout on mobile.

**Each customer row shows:**
- Full name — bold, link to `/admin/customers/[id]`
- Email — muted
- Phone — muted
- Join date — `"Joined [month year]"`
- Bookings count — `"[n] booking${n !== 1 ? 's' : ''}"`
- Upcoming class indicator — small blue badge `"Upcoming"` if they have an upcoming booking
- Cert status indicator:
  - Green badge `"Certified"` if has active certs and none expiring soon
  - Amber badge `"Expiring Soon"` if any cert expires within 90 days
  - Red badge `"Expired"` if all certs are expired
  - Gray badge `"No Certs"` if no certifications at all
- Account status badge — red `"Archived"` if account is archived, green `"Active"` if not

**Row click:** Navigates to `/admin/customers/[id]`

### Empty State
- If search returns no results: `"No customers found matching '[query]'."`
- If no customers at all: `"No customers yet."`

---

## Create Customer

**Button:** `"+ New Customer"` in page header — manager and super admin only.

**Opens an inline slide-in panel** from the right side.

**Form fields:**
- First name (required)
- Last name (required)
- Email (required)
- Phone (optional)

**Submit button:** `"Create Account & Send Setup Email"`

**On submit — API route `app/api/customers/create/route.ts`:**

```typescript
export async function POST(request: Request) {
  const supabase = createClient()
  const { firstName, lastName, email, phone } = await request.json()

  // 1. Check for duplicate email
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return Response.json(
      { success: false, error: 'An account with this email already exists.' },
      { status: 409 }
    )
  }

  // 2. Create Supabase auth user
  const tempPassword = crypto.randomUUID()
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return Response.json({ success: false, error: 'Failed to create account.' }, { status: 500 })
  }

  // 3. Insert profile record
  await supabase.from('profiles').insert({
    id: authData.user.id,
    first_name: firstName,
    last_name: lastName,
    email,
    phone: phone || null,
    role: 'customer',
  })

  // 4. Generate password setup link
  const { data: linkData } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
  })

  // 5. Send account setup email via Resend
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'Superhero CPR <noreply@superherocpr.com>',
    to: email,
    subject: 'Set up your Superhero CPR account',
    html: `
      <h1>Welcome to Superhero CPR, ${firstName}!</h1>
      <p>An account has been created for you. Click the link below to set your password and activate your account.</p>
      <p><a href="${linkData.properties.action_link}">Set My Password →</a></p>
      <p>This link expires in 24 hours.</p>
      <p>— The Superhero CPR Team</p>
    `,
  })

  return Response.json({ success: true })
}
```

**After successful creation:**
- Close the slide-in panel
- Show success toast: `"Account created. Setup email sent to [email]."`
- Refresh the customer list

---

## Page Assembly

```typescript
export default async function CustomersPage() {
  // auth + access check (manager/super admin only)
  // initial data fetch — all customers including archived
  return (
    <main>
      <CustomersClient
        initialCustomers={customersWithMeta}
        userRole={profile.role}
      />
    </main>
  )
}
```

---

## Responsive

- Mobile: Card layout — each customer is a card with name, email, cert badge, booking count, status badge
- Desktop: Table layout — compact rows with all columns

---

## Accessibility

- Search input must have `aria-label="Search customers"`
- Filter pills must be `<button>` elements with `aria-pressed`
- Table must have proper `<thead>` with `<th scope="col">` headers
- Loading state must use `aria-live="polite"` on the results container
- Create customer panel must trap focus when open

---

## What NOT to Do

- Do not hide archived customers behind a toggle — all customers are always visible
- Do not load all customers at once — use server-side search with 100 record limit
- Do not allow instructors to access this page
- Do not create customer with a known password — use Supabase password recovery flow
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to manager and super admin
- [ ] Initial load shows first 50 customers ordered by last name — includes archived
- [ ] Search debounced 300ms, queries server
- [ ] Search works by name, email, and phone — includes archived customers
- [ ] Cert status filter works correctly
- [ ] Booking activity filter works correctly
- [ ] Account status filter (All / Active / Archived) works correctly
- [ ] Active and archived badges shown on every row
- [ ] Each row links to customer detail page
- [ ] Create customer panel opens as slide-in
- [ ] Duplicate email check works with clear error message
- [ ] Account setup email sent via Resend with password recovery link
- [ ] Success toast shown after customer creation
- [ ] Customer list refreshes after creation
- [ ] Empty state renders correctly
- [ ] Fully responsive — table on desktop, cards on mobile
- [ ] No TypeScript errors
- [ ] No ESLint errors
