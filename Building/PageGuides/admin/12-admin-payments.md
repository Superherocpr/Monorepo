# Admin Payments Build Guide
**Route:** `/admin/payments`
**File:** `app/(admin)/payments/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the payments page for **Superhero CPR**. This page shows all payment records across the system. Filters are the primary way staff find specific payments — they should be prominent and always visible. The list is paginated at 50 records per page. Payments are append-only — no editing or deleting.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Manager and Super Admin only.

---

## Architecture

Hybrid — server fetches initial page of data + summary stats. Filters and pagination trigger new server fetches via URL search params (not client-side filtering — dataset is too large).

Each filter change updates the URL, which triggers a new server render. This keeps the page shareable and bookmarkable.

```
/admin/payments?type=cash&status=completed&page=2
```

---

## Data Fetching

```typescript
const page = parseInt(searchParams.page ?? '1')
const pageSize = 50
const offset = (page - 1) * pageSize

// Build filtered query
let query = supabase
  .from('payments')
  .select(`
    id, amount, status, payment_type,
    paypal_transaction_id, notes, created_at,
    customer:profiles!customer_id (
      id, first_name, last_name, email
    ),
    booking:bookings!booking_id (
      id,
      class_sessions (
        starts_at,
        class_types ( name ),
        profiles ( first_name, last_name )
      )
    ),
    logged_by_profile:profiles!logged_by (
      first_name, last_name
    )
  `, { count: 'exact' })
  .order('created_at', { ascending: false })
  .range(offset, offset + pageSize - 1)

// Apply filters from searchParams
if (searchParams.type) query = query.eq('payment_type', searchParams.type)
if (searchParams.status) query = query.eq('status', searchParams.status)
if (searchParams.from) query = query.gte('created_at', searchParams.from)
if (searchParams.to) query = query.lte('created_at', searchParams.to + 'T23:59:59')

const { data: payments, count } = await query
const totalPages = Math.ceil((count ?? 0) / pageSize)

// Summary stats — this month only, unfiltered
const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
const { data: monthlyStats } = await supabase
  .from('payments')
  .select('amount, payment_type, status')
  .eq('status', 'completed')
  .gte('created_at', startOfMonth)
```

---

## Page Header

- `<h1>`: `"Payments"`
- **Log Payment button** → opens slide-in panel (manager/super admin)

---

## Summary Strip

Two metric cards side by side:

**Online & Invoice Revenue (this month):**
- Sum of `amount` where `payment_type IN ('online', 'invoice')` AND `status = 'completed'`
- Label: `"Online & Invoice — This Month"`

**Cash & Check Logged (this month):**
- Sum of `amount` where `payment_type IN ('cash', 'check', 'deposit')` AND `status = 'completed'`
- Label: `"Cash & Check — This Month"`

Style: metric cards from the admin design system — `bg-gray-50`, large number, muted label.

---

## Filter Bar

**Always visible above the list.** Not collapsible. Prominent.

**Filters — all rendered as a horizontal row of labeled dropdowns/inputs:**

**Payment type** (dropdown):
- All types
- Online (PayPal)
- Cash
- Check
- Deposit
- Invoice

**Status** (pill buttons — all visible at once):
- All
- Completed (green)
- Pending (amber)
- Failed (red)

**Date range** (two date inputs):
- From
- To

**Customer search** (text input):
- Searches by customer name or email
- On submit (Enter or search button): adds `customer=[term]` to URL params
- Server applies: `.ilike` filter on customer name/email via join

**Instructor** (dropdown):
- All instructors
- Individual instructor — filters to payments for that instructor's sessions

**Clear all filters** link — only shown when any filter is active. Resets to `/admin/payments`.

Each filter change navigates to a new URL with updated search params. Use Next.js `<Link>` or `router.push()` for filter updates — not a form submit.

---

## Payments List

Table on desktop, cards on mobile.

**Table columns:**
- Date — `"Apr 14, 2026 9:32 AM"`
- Customer — name + email (muted below)
- Class — class type name + date (muted below). If no booking linked: `"—"`
- Instructor — from the booking's session. If no booking: `"—"`
- Amount — formatted as currency, bold
- Type badge:
  - `online` → blue `"Online"`
  - `cash` → gray `"Cash"`
  - `check` → gray `"Check"`
  - `deposit` → purple `"Deposit"`
  - `invoice` → teal `"Invoice"`
- Status badge:
  - `completed` → green `"Completed"`
  - `pending` → amber `"Pending"`
  - `failed` → red `"Failed"`
- PayPal transaction ID — monospace, truncated to 12 chars + `"..."` on hover shows full. Only shown for online payments.
- Logged by — muted small text. Only shown for manually logged payments (cash/check/deposit). Format: `"Logged by [name]"`
- Notes — muted small text, shown if not null

**Row click:** No action — payments are read-only. No link needed.

---

## Pagination

Below the list:

```
Showing [start]–[end] of [total] payments
[← Previous]  [Page 1 of N]  [Next →]
```

- Previous/Next are `<Link>` components updating the `page` param in the URL
- Current page shown as plain text
- Previous disabled on page 1, Next disabled on last page

---

## Log Payment Slide-In Panel

**Triggered by:** `"Log Payment"` button in page header

**Fields:**
- Customer — searchable dropdown. Type to search by name or email. Required.
- Booking — dropdown of that customer's upcoming/recent bookings. Updates when customer is selected. Required.
- Payment type — dropdown: Cash / Check / Deposit
- Amount (required) — number input, currency formatted
- Notes (optional) — text field

**On submit:**
```typescript
// POST /api/payments/log
// Creates payment record with:
// - customer_id
// - booking_id
// - payment_type
// - amount
// - status: 'completed'
// - logged_by: staff_id
// - notes
```

**After successful log:**
- Close panel
- Show success toast: `"Payment of $[amount] logged for [customer name]."`
- Refresh payment list (navigate to page 1 with current filters)

---

## Empty State

When no payments match filters:
- Icon: `Receipt` from Lucide
- Text: `"No payments found matching your filters."`
- `"Clear filters"` link

---

## Responsive

- Mobile: Card layout — each payment is a card showing customer, class, amount, type, status, date
- Desktop: Full table with all columns
- Filter bar: wraps to multiple rows on mobile, single row on desktop

---

## Typography & Brand

- **Summary cards:** `bg-gray-50 rounded-lg p-4`
- **Filter bar:** `bg-white border border-gray-200 rounded-lg p-4 mb-6`
- **Status filter pills:** same style as schedule page
- **Table rows:** `hover:bg-gray-50` — read-only, no cursor pointer
- **Failed status badge:** `bg-red-100 text-red-700` — same red as other danger states
- **Amount:** `font-semibold text-gray-900`
- **Transaction ID:** `font-mono text-xs text-gray-500`

---

## Accessibility

- Table must have `<thead>` with `<th scope="col">` for all columns
- Filter inputs must have `<label>` elements
- Status pill buttons must use `aria-pressed`
- Pagination buttons must have `aria-label="Previous page"` / `"Next page"`
- Pagination current page must have `aria-current="page"`
- Log payment panel must trap focus when open

---

## What NOT to Do

- Do not allow editing or deleting payments — append-only
- Do not filter client-side — dataset too large, use URL params + server render
- Do not hide the filter bar — it must always be visible
- Do not combine online and cash/check revenue in the summary strip — keep them separate
- Do not allow logging a payment without both customer and booking
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to manager and super admin
- [ ] Summary strip shows correct monthly totals — online/invoice separate from cash/check
- [ ] Filter bar always visible, all filters working
- [ ] Payment type filter works
- [ ] Status filter (including failed) works
- [ ] Date range filter works
- [ ] Customer search filter works
- [ ] Instructor filter works
- [ ] Clear all filters resets correctly
- [ ] Filter changes update URL params
- [ ] Pagination works — 50 per page, URL-based
- [ ] Previous/Next disabled correctly at boundaries
- [ ] Payments list shows all fields correctly
- [ ] Type and status badges correct
- [ ] Transaction ID truncated with full on hover
- [ ] Logged by shown for manual payments only
- [ ] Log payment panel opens as slide-in
- [ ] Log payment requires customer and booking
- [ ] Customer dropdown is searchable
- [ ] Booking dropdown updates when customer is selected
- [ ] Payment logged correctly with logged_by attribution
- [ ] Empty state renders when no payments match filters
- [ ] Fully responsive — table desktop, cards mobile
- [ ] No TypeScript errors
- [ ] No ESLint errors
