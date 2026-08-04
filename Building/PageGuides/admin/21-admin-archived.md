# Admin Archived Accounts Build Guide
**Route:** `/admin/archived`
**File:** `app/(admin)/archived/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the archived accounts page for **Superhero CPR**. This page shows all customer accounts that have been archived (soft-deleted). Super admins can view archived customers and restore their accounts. Archived accounts belong to customers only — staff accounts use a separate `deactivated` field managed from `/admin/staff`.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Super Admin only.

---

## Architecture

Hybrid — server fetches all archived customers. Client component handles search filtering and restore action.

---

## Data Fetching

```typescript
const { data: archivedCustomers } = await supabase
  .from('profiles')
  .select(`
    id, first_name, last_name, email, phone,
    archived_at, created_at,
    bookings ( id ),
    certifications ( id ),
    orders ( id )
  `)
  .eq('role', 'customer')
  .eq('archived', true)
  .order('archived_at', { ascending: false })

const customersWithMeta = (archivedCustomers ?? []).map(c => ({
  ...c,
  bookingCount: c.bookings.length,
  certCount: c.certifications.length,
  orderCount: c.orders.length,
}))
```

---

## Page Header

- `<h1>`: `"Archived Accounts"`
- Subtext: `"These customer accounts have been archived. All data is preserved. You can restore access at any time."`
- Count badge: `"[n] archived account${n !== 1 ? 's' : ''}"`

---

## Search Bar

Client-side search — dataset is small enough.
- Placeholder: `"Search by name or email..."`
- Filters the list as the super admin types
- Searches `first_name`, `last_name`, `email`

---

## Archived Customers List

Table on desktop, cards on mobile.

**Each row shows:**
- Full name — bold
- Email — muted
- Phone — muted
- Archived date — `"Archived [date]"` in red muted text
- Customer since — `"Customer since [month year]"`
- Data summary — `"[n] bookings · [n] certs · [n] orders"` — confirms data is preserved
- **Restore button** — opens inline confirmation

---

## Restore Account

Inline confirmation on the row:
```
"Restore access for [name]? They will be able to log in again."
[Cancel]  [Restore Account]
```

On confirm — `POST /api/customers/restore`:

```typescript
export async function POST(request: Request) {
  const supabase = createClient()
  const { customerId } = await request.json()

  // Verify super admin
  const { data: { user } } = await supabase.auth.getUser()
  const { data: actor } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (actor?.role !== 'super_admin') {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 403 })
  }

  // Restore profile
  const { error } = await supabase
    .from('profiles')
    .update({
      archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)
    .eq('role', 'customer') // safety check — only restore customers

  if (error) {
    return Response.json({ success: false, error: 'Failed to restore account.' }, { status: 500 })
  }

  // Note: Supabase auth account was never deleted — the customer can log in immediately
  // The archived check in the dashboard layout will no longer block them

  return Response.json({ success: true })
}
```

After restore:
- Row disappears from the archived list immediately
- Success toast: `"Account restored. [name] can now log in again."`

---

## Empty State

- Icon: `CheckCircle2` from Lucide, `text-green-500`
- Heading: `"No archived accounts"`
- Body: `"All customer accounts are currently active."`

---

## Responsive

- Mobile: Card layout
- Desktop: Table layout

---

## What NOT to Do

- Do not show staff accounts here — archived is for customers only, deactivated staff live in `/admin/staff`
- Do not hard-delete any data on restore — just clear `archived` and `archived_at`
- Do not allow managers to access this page — super admin only
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to super admin
- [ ] All archived customers shown with data summary
- [ ] Client-side search works by name and email
- [ ] Restore requires inline confirmation
- [ ] Restore clears archived fields correctly
- [ ] Restored customer disappears from list immediately
- [ ] Success toast shown after restore
- [ ] Empty state renders correctly
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
