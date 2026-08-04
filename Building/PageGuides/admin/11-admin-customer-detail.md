# Admin Customer Detail Build Guide
**Route:** `/admin/customers/[id]`
**File:** `app/(admin)/customers/[id]/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the customer detail page for **Superhero CPR**. This page gives managers and super admins a complete view of a single customer — their profile, bookings, certifications, orders, and payments. Staff can edit profile info, cancel bookings (with reason), manually add bookings, manually issue certs, log payments, update order tracking, and send a password reset email. Tabs switch client-side with no additional DB queries.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for password reset email

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Manager and Super Admin only.

---

## Architecture

Hybrid — server fetches all customer data in one `Promise.all`, passes to client component. Client component handles tabs, inline forms, and all mutations via API routes.

`page.tsx` — server wrapper, fetches all data, passes to `CustomerDetailClient.tsx`
`CustomerDetailClient.tsx` — client component owning tab state and all actions

---

## Data Fetching — All in One `Promise.all`

```typescript
const [profile, bookings, certifications, orders, payments] = await Promise.all([

  // Profile
  supabase
    .from('profiles')
    .select('id, first_name, last_name, email, phone, address, city, state, zip, role, archived, archived_at, created_at')
    .eq('id', params.id)
    .single(),

  // Bookings with session and payment info
  supabase
    .from('bookings')
    .select(`
      id, booking_source, cancelled, cancellation_note,
      cancelled_by, manual_booking_reason, created_by,
      grade, created_at,
      class_sessions (
        id, starts_at, ends_at, status,
        class_types ( name ),
        locations ( name, city, state ),
        profiles ( first_name, last_name )
      ),
      payments ( id, amount, status, payment_type, created_at )
    `)
    .eq('customer_id', params.id)
    .order('created_at', { ascending: false }),

  // Certifications
  supabase
    .from('certifications')
    .select(`
      id, issued_at, expires_at, cert_number, notes,
      cert_types ( name, issuing_body, validity_months ),
      class_sessions ( starts_at, class_types ( name ) )
    `)
    .eq('customer_id', params.id)
    .order('expires_at', { ascending: true }),

  // Merch orders
  supabase
    .from('orders')
    .select(`
      id, status, total_amount, tracking_number,
      shipping_name, shipping_address, shipping_city,
      shipping_state, shipping_zip, created_at,
      order_items (
        quantity, price_at_purchase,
        product_variants ( size, products ( name ) )
      )
    `)
    .eq('customer_id', params.id)
    .order('created_at', { ascending: false }),

  // Payments
  supabase
    .from('payments')
    .select(`
      id, amount, status, payment_type,
      paypal_transaction_id, notes, created_at, logged_by,
      bookings (
        class_sessions ( starts_at, class_types ( name ) )
      )
    `)
    .eq('customer_id', params.id)
    .order('created_at', { ascending: false }),
])
```

If profile not found or not a customer role: redirect to `/admin/customers`.

---

## Page Header

Always visible — not inside tabs.

- Customer full name — `<h1>`
- Email and phone — muted
- Join date — `"Customer since [month year]"`
- Account status badge:
  - Active: green `"Active"`
  - Archived: red `"Archived"` + `"Archived on [date]"`
- **Archive account button** — super admin only, shown only if not already archived
  - Opens inline confirmation:
    ```
    "Archive this account? The customer will lose access but all data will be preserved."
    [Cancel]  [Archive Account]
    ```
  - On confirm: calls archive API route, refreshes page

---

## Edit Profile Section

Always visible above tabs — not inside a tab.

Inline editable fields (manager/super admin):
- First name, last name, email, phone, address, city, state, zip
- All fields editable inline — click to edit, Enter or blur to save per field
- Each field saves individually on blur — no Save All button on this section
- Email changes: show note `"Supabase will send a confirmation to the new email address"`

**Send Password Reset Email button:**
- Label: `"Send Password Reset Email"`
- Calls API route that generates a Supabase password recovery link and sends via Resend
- On success: `"Password reset email sent to [email]."`
- Cannot change password directly — only the customer can set their own password

---

## Tabs

Five tabs: **Bookings | Certifications | Orders | Payments | Notes**

Tab switching is instant — all data already loaded. Active tab highlighted in red.

---

### Tab 1 — Bookings

**Add Booking button** (manager/super admin):
- Opens slide-in panel
- Fields:
  - Select session — dropdown of approved upcoming sessions with spots remaining
  - Reason (required) — text field explaining why this booking is being manually added
- On submit: creates booking with `booking_source = 'manual'`, `created_by = staff_id`, `manual_booking_reason = reason`
- Booking appears in list immediately

**Booking list — same sections as customer's own bookings page:**

Upcoming bookings:
- Class name, date, time, instructor, location
- Booking source badge: `online` / `rollcall` / `invoice` / `manual`
- If `manual`: show `manual_booking_reason` inline — `"Added manually: [reason]"`
- Payment status badge
- **Grade** — shown here (staff can see grades, customers cannot)
- **Cancel booking button** — opens inline confirmation:
  ```
  "Cancel this booking?"
  Reason: [text input, required]
  [Cancel]  [Confirm Cancellation]
  ```
  On confirm: set `cancelled = true`, `cancellation_note = reason`, `cancelled_by = staff_id`

Past bookings:
- Compact list — class name, date, grade, booking source badge

Cancelled bookings:
- Collapsible `<details>` / `<summary>` — same as customer portal
- Shows cancellation reason and who cancelled it

---

### Tab 2 — Certifications

**Issue Cert button** (manager/super admin):
- Opens slide-in panel
- Fields:
  - Cert type — dropdown from `cert_types` where `active = true`
  - Issue date (required) — date picker, defaults to today
  - Cert number (optional)
  - Notes (optional)
- Expiry date auto-calculated: issue date + `cert_types.validity_months`
- On submit: creates certification record with `session_id = null` (manually issued)

**Cert list:**
- Same layout as customer's certifications page
- Each cert shows: cert type, issuing body, issued date, expiry countdown (green/amber/red)
- Cert number if available
- Notes if present (admin notes — not shown to customer)
- `"Book Renewal"` link for active certs

---

### Tab 3 — Orders

**Order list:**
- Same layout as customer's orders page
- Each order shows: date, status badge, items, total, shipping address, tracking number
- **Update Tracking** button — opens inline input to add/edit tracking number
  - On save: updates `orders.tracking_number`

---

### Tab 4 — Payments

**Log Payment button** (manager/super admin):
- Opens slide-in panel
- Fields:
  - Payment type — dropdown: cash / check / deposit
  - Amount (required)
  - Booking — optional dropdown linking payment to a specific booking
  - Notes (optional)
- On submit: creates payment record with `logged_by = staff_id`

**Payment list:**
- Each payment shows: date, amount, type badge, status badge, linked booking (if any), PayPal transaction ID (if online), notes, logged by (if manual)

---

### Tab 5 — Notes

A simple free-text notes area for internal staff notes about this customer.

This requires a `customer_notes` field on the `profiles` table — add it as a nullable text field.

- Large textarea, full width
- Auto-saves on blur — no save button
- Note: `"These notes are internal and not visible to the customer."`

---

## API Routes Needed

**`/api/customers/[id]/update-profile`** — PATCH, updates profile fields
**`/api/customers/[id]/send-password-reset`** — POST, generates recovery link + sends email
**`/api/customers/[id]/archive`** — POST, archives account (super admin only)
**`/api/customers/[id]/add-booking`** — POST, creates manual booking
**`/api/customers/[id]/cancel-booking`** — POST, cancels booking with reason
**`/api/customers/[id]/issue-cert`** — POST, manually issues a certification
**`/api/customers/[id]/log-payment`** — POST, logs a cash/check/deposit payment
**`/api/customers/[id]/update-tracking`** — PATCH, updates order tracking number
**`/api/customers/[id]/update-notes`** — PATCH, updates internal staff notes

---

## Schema Addition

Add `customer_notes` to `profiles`:
```sql
alter table profiles add column customer_notes text;
```
Staff-only field. Never exposed to the customer.

---

## Responsive

- Mobile: Single column. Header stacked. Tabs scroll horizontally.
- Desktop: Header full width. Tabs with comfortable spacing.

---

## Accessibility

- Tab buttons must use `role="tab"`, `aria-selected`, `aria-controls`
- Tab panels must use `role="tabpanel"`, `aria-labelledby`
- All inline confirmation forms must be keyboard navigable
- Slide-in panels must trap focus when open

---

## What NOT to Do

- Do not show grades to customers — only visible in admin
- Do not allow managers to change the customer's password directly — send reset email only
- Do not fetch data per tab — load everything once in `Promise.all`
- Do not allow booking cancellation without a reason
- Do not allow manual booking without a reason
- Do not allow archival from manager role — super admin only
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to manager and super admin
- [ ] All data loaded in one `Promise.all` — no per-tab fetching
- [ ] Profile edit fields save individually on blur
- [ ] Password reset email sent via Resend — no direct password change
- [ ] Archive button visible to super admin only, requires confirmation
- [ ] Bookings tab shows all bookings with grades visible
- [ ] Manual booking requires reason, tracked with `created_by`
- [ ] Booking cancellation requires reason, tracked with `cancelled_by`
- [ ] Manual bookings show reason inline on the booking row
- [ ] Certifications tab shows all certs with admin notes visible
- [ ] Issue cert panel works — expiry auto-calculated
- [ ] Orders tab shows tracking update button
- [ ] Payments tab shows all payments with logged_by attribution
- [ ] Log payment panel works — payment linked to booking if selected
- [ ] Notes tab auto-saves on blur
- [ ] Tabs switch instantly with no additional DB queries
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
