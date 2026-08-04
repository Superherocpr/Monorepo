# Admin Invoice Detail Build Guide
**Route:** `/admin/invoices/[id]`
**File:** `app/(admin)/invoices/[id]/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the invoice detail page for **Superhero CPR**. This page shows all details of a single invoice and provides actions: mark as paid (manual platforms), resend (with corrected email), and cancel. Cancellation notifies the payment platform API to void the invoice on their end.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for sending emails

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:**
- Instructor: own invoices only
- Manager: all invoices (view only — no mark paid or cancel)
- Super Admin: all invoices, all actions

---

## Supported Payment Platforms

Only these platforms are supported. All have APIs for invoice cancellation:
- PayPal
- Square
- Stripe
- Venmo Business

There is no manual platform option. Every invoice is tied to one of these four.

---

## Data Fetching

```typescript
const { data: invoice } = await supabase
  .from('invoices')
  .select(`
    id, invoice_number, invoice_type, recipient_name,
    recipient_email, company_name, student_count,
    amount_per_student, custom_price, total_amount,
    payment_platform, platform_invoice_id,
    status, notes, created_at, paid_at, cancelled_at,
    class_sessions (
      id, starts_at, ends_at,
      class_types ( name ),
      locations ( name, address, city, state, zip )
    ),
    profiles ( id, first_name, last_name ),
    invoice_activity_log (
      id, action, notes, created_at,
      profiles ( first_name, last_name )
    )
  `)
  .eq('id', params.id)
  .single()

// Access check
if (profile.role === 'instructor' && invoice.instructor_id !== profile.id) {
  redirect('/admin/invoices')
}
```

---

## Page Layout

Two-column on desktop (main content left, sidebar right). Single column on mobile.

---

## Main Content

### Invoice Header
- Invoice number — large monospace: `INV-00042`
- Status badge — sent/paid/cancelled
- Payment platform badge
- Created date

### Recipient Details
- Recipient name
- Recipient email
- Company name (if group invoice)
- Invoice type badge: Individual / Group

### Class Details
- Class type name
- Date and time
- Location — full address block
- Instructor name

### Invoice Summary
- Student count
- Amount per student (if not custom price)
- Custom price badge if applicable
- **Total amount — large, bold**
- Paid date (if paid)
- Cancelled date (if cancelled)

### Custom Note
If `invoice.notes` is not null, show:
```
"Note to recipient: [notes]"
```

### Activity Log
Chronological list of all actions from `invoice_activity_log`:
- Action label
- Who performed it: `"[first_name] [last_name]"`
- When: formatted timestamp
- Notes if present

Style: compact timeline, oldest first, small text.

---

## Sidebar — Actions

Actions shown based on invoice status and viewer role.

### Status: `sent`

**Mark as Paid** — instructor (own) and super admin only:
- Button: `"Mark as Paid"`
- Opens inline confirmation:
  ```
  "Confirm this invoice has been paid manually?"
  [Cancel]  [Confirm — Mark Paid]
  ```
- On confirm: set `status = 'paid'`, `paid_at = now()`. Log action. Send paid notification email to instructor and manager.

**Resend Invoice** — instructor (own) and super admin only:
- Button: `"Resend Invoice"`
- Opens inline form:
  ```
  Send to: [email input — pre-filled with current recipient_email]
  Note: "The invoice will be sent to this address. Update it if the original was incorrect."
  [Cancel]  [Send]
  ```
- On send: resend invoice email to the new address. If email changed, update `recipient_email` on the invoice. Log action with note of address change if applicable.

**Cancel Invoice** — instructor (own) and super admin only:
- Button: `"Cancel Invoice"` — red outline
- Opens inline confirmation:
  ```
  "Cancelling this invoice will void it on [platform] and it cannot be undone."
  [Cancel]  [Confirm Cancellation]
  ```
- On confirm:
  1. Call platform API to void/cancel the invoice (see Platform Cancellation section)
  2. Set `status = 'cancelled'`, `cancelled_at = now()`
  3. Log action
  4. Show success: `"Invoice cancelled and voided on [platform]."`

### Status: `paid`
- No actions available
- Show: `"This invoice has been paid."`

### Status: `cancelled`
- No actions available
- Show: `"This invoice has been cancelled."`
- `"Create New Invoice"` link → `/admin/invoices/new?session=[session_id]` — instructor and super admin only

---

## Platform Cancellation API Route

**File:** `app/api/invoices/cancel/route.ts`

```typescript
export async function POST(request: Request) {
  const { invoiceId } = await request.json()
  const supabase = createClient()

  // Fetch invoice created through the SuperHeroCPR business PayPal account
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, platform_invoice_id, payment_platform, instructor_id, status')
    .eq('id', invoiceId)
    .single()

  if (invoice.status !== 'sent') {
    return Response.json({ success: false, error: 'Invoice is not in sent status' }, { status: 400 })
  }

  // Call PayPal with the business REST access token to cancel the invoice
  const platformSuccess = await cancelPayPalInvoice(invoice.platform_invoice_id)

  if (!platformSuccess) {
    return Response.json(
      { success: false, error: 'Failed to cancel invoice on payment platform. Please try again or contact support.' },
      { status: 500 }
    )
  }

  // Update invoice in DB
  await supabase
    .from('invoices')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', invoiceId)

  // Log activity
  await supabase
    .from('invoice_activity_log')
    .insert({ invoice_id: invoiceId, actor_id: userId, action: 'cancelled' })

  return Response.json({ success: true })
}
```

**Important:** If the platform API call fails, do NOT update the invoice status in our DB. The cancellation must succeed on the platform before we record it locally. Show the instructor a clear error message if cancellation fails.

---

## Resend API Route

**File:** `app/api/invoices/resend/route.ts`

```typescript
export async function POST(request: Request) {
  const { invoiceId, newEmail } = await request.json()

  // Fetch invoice details
  // If email changed from original, update recipient_email on invoice
  // Resend the invoice email to newEmail
  // Log action — include note if email was changed:
  //   "Resent to [newEmail]" or "Resent to [newEmail] (corrected from [originalEmail])"
}
```

---

## Mark Paid API Route

**File:** `app/api/invoices/mark-paid/route.ts`

```typescript
export async function POST(request: Request) {
  const { invoiceId } = await request.json()

  // Verify instructor owns invoice OR super admin
  // Set status = 'paid', paid_at = now()
  // Create booking records for student_count spots
  // Log action: "marked_paid"
  // Send paid notification email to instructor + manager
}
```

---

## Responsive

- Mobile: Single column. Actions below main content.
- Desktop: Two columns — main content left (wider), actions sidebar right (narrower).

---

## What NOT to Do

- Do not allow managers to mark paid, resend, or cancel — view only for managers
- Do not update invoice status if platform cancellation API fails
- Do not allow editing invoice details — cancel and reissue only
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted correctly per role
- [ ] All invoice details render correctly
- [ ] Activity log renders chronologically
- [ ] Mark as paid works — inline confirmation, DB update, email sent
- [ ] Resend works — email field pre-filled, corrected email saved if changed
- [ ] Cancel works — platform API called first, DB updated only on success
- [ ] Platform cancellation failure shows clear error — does not update DB
- [ ] Cancelled invoice shows reissue link for instructor/super admin
- [ ] Managers see invoice details but no action buttons
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
