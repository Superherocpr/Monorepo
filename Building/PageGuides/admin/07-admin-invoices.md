# Admin Invoices List Build Guide
**Route:** `/admin/invoices`
**File:** `app/(admin)/invoices/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the invoices list page for **Superhero CPR**. Instructors see only their own invoices. Managers and super admins see all invoices across all instructors. This page is a filterable list — all invoice actions (mark paid, cancel, resend) happen on the invoice detail page.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Instructor, Manager, Super Admin.

---

## Architecture

Hybrid — server fetches data, client component handles filtering.

---

## Data Fetching

```typescript
const query = supabase
  .from('invoices')
  .select(`
    id, invoice_number, invoice_type, recipient_name,
    recipient_email, company_name, student_count,
    total_amount, status, payment_platform,
    custom_price, created_at, paid_at, cancelled_at,
    class_sessions (
      id, starts_at,
      class_types ( name )
    ),
    profiles ( first_name, last_name )
  `)
  .order('created_at', { ascending: false })

// Instructors see only their own
if (profile.role === 'instructor') {
  query.eq('instructor_id', profile.id)
}

const { data: invoices } = await query

// Fetch instructors for filter dropdown (manager/super admin only)
const instructors = ['manager', 'super_admin'].includes(profile.role)
  ? await fetchInstructors(supabase)
  : []
```

---

## Page Header

- `<h1>`: `"Invoices"`
- `"Create Invoice"` button → `/admin/invoices/new` — instructor and super admin only

---

## Filter Bar (Client-Side)

**Filters:**
- Status — All / Sent / Paid / Cancelled
- Invoice type — All / Individual / Group
- Date range — From / To
- Instructor — dropdown (manager/super admin only)
- Class — dropdown of classes that have invoices

Default: show `sent` status only (active invoices).

---

## Invoice List

Flat list, most recent first. No grouping.

**Each invoice row/card shows:**
- Invoice number — monospace, e.g. `INV-00042`
- Recipient name — bold. If group: company name + `"(Group)"`
- Class name and date — muted
- Instructor name — shown for manager/super admin views only
- Student count — `"[n] student${n !== 1 ? 's' : ''}"`
- Total amount — formatted as currency. If custom price: small badge `"Custom price"`
- Payment platform badge — PayPal / Square / Stripe / Venmo Business
- Status badge:
  - `sent` → blue `"Sent"`
  - `paid` → green `"Paid"`
  - `cancelled` → gray `"Cancelled"`
- Date sent — `"Sent [date]"`
- If paid: `"Paid [date]"` in green
- If cancelled: `"Cancelled [date]"` in gray
- `"View"` link → `/admin/invoices/[id]`

---

## Empty State

- Icon: `FileText` from Lucide
- Text: `"No invoices found."`
- If instructor with no invoices: add `"Create Invoice"` CTA button

---

## Page Assembly

```typescript
export default async function InvoicesPage() {
  // fetch data
  return (
    <main>
      <InvoicesClient
        invoices={invoices}
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

- Mobile: Card layout, one per row
- Desktop: Table-style rows with tighter spacing

---

## What NOT to Do

- Do not show invoice actions on this page — all actions on detail page
- Do not show other instructors' invoices to instructors
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Instructors see only their own invoices
- [ ] Managers/super admins see all invoices with instructor name
- [ ] All filters work client-side
- [ ] Default filter shows sent invoices only
- [ ] Status badges correct
- [ ] Custom price badge shown when applicable
- [ ] Create Invoice button shown for instructor and super admin only
- [ ] Empty state renders correctly
- [ ] All View links go to correct detail page
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
