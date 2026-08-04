# Admin Create Invoice Build Guide
**Route:** `/admin/invoices/new`
**File:** `app/(admin)/invoices/new/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the create invoice page for **Superhero CPR**. Instructors use this tool to send PayPal invoices from the SuperHeroCPR business account to individuals or companies for spots in approved classes. The flow is a 3-step wizard. The instructor must have a PayPal payout email saved before they can create an invoice.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for sending invoice emails

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Instructor and Super Admin only.

---

## Payout Email Gate

Before rendering the invoice creation form, check if the instructor has a PayPal payout email saved:

```typescript
const { data: instructorProfile } = await supabase
  .from('profiles')
  .select('paypal_payout_email')
  .eq('id', profile.id)
  .single()
```

If no payout email exists, do not render the form. Instead render a full-page prompt:

```
Icon: CreditCard from Lucide, text-gray-400, size 48px
Heading: "Add a Payout Email First"
Body: "Add the PayPal email where SuperHeroCPR should send your instructor payouts before creating invoices."
Button: "Add Payout Email" → /admin/profile/payment
```

Note: Super admins bypass this check. For instructors, the payout email does not receive the customer payment directly; it is used later when the super admin sends PayPal Payouts.

---

## Pre-population from Query Param

If `?session=[id]` is present in the URL (e.g. coming from session detail page), pre-select that session in Step 1 and skip directly to Step 2.

```typescript
const preSelectedSessionId = searchParams.session ?? null
```

---

## Data Fetching

```typescript
// Fetch instructor's approved upcoming sessions
const { data: availableSessions } = await supabase
  .from('class_sessions')
  .select(`
    id, starts_at, ends_at, max_capacity,
    class_types ( id, name, price ),
    locations ( name, city, state ),
    bookings ( id, cancelled ),
    invoices ( id, student_count, status )
  `)
  .eq('instructor_id', instructorId)
  .eq('approval_status', 'approved')
  .gte('starts_at', new Date().toISOString())
  .order('starts_at', { ascending: true })

// Compute available spots per session
const sessionsWithAvailability = availableSessions.map(session => {
  const activeBookings = session.bookings.filter(b => !b.cancelled).length
  const activeInvoiceStudents = session.invoices
    .filter(inv => inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + inv.student_count, 0)
  const spotsRemaining = session.max_capacity - activeBookings - activeInvoiceStudents
  return { ...session, spotsRemaining }
})
```

**Note on spots remaining:** Subtract both active bookings AND active invoice student counts from max capacity. An invoice reserves spots even before it's paid.

---

## Architecture

Client component — multi-step wizard with local state.

`page.tsx` — server wrapper, fetches sessions and payout email status, passes to `CreateInvoiceClient.tsx`

`CreateInvoiceClient.tsx` — client component owning all step state

---

## Step Indicator

At the top of the page, a 3-step progress indicator:
1. Select Class
2. Invoice Details
3. Review & Send

Active step highlighted in red. Completed steps show checkmark.

---

## Step 1 — Select a Class

**If `preSelectedSessionId` is present:** skip this step entirely, auto-advance to Step 2.

**Layout:** Heading `"Select a Class"` + list of available sessions

**Each session option shows:**
- Class type name — bold
- Date and time
- Location name, city, state
- Spots remaining — `"[n] spots available"`
  - Green if 5+
  - Amber if 1-4: `"Only [n] spots left"`
  - Red/disabled if 0: `"No spots available"` — cannot select

Clicking a session selects it (highlighted border) and auto-advances to Step 2.

**Empty state:** If no approved upcoming sessions:
```
"No approved upcoming classes available for invoicing.
 Classes must be approved before you can send invoices for them."
Link: "View my classes" → /admin/sessions
```

---

## Step 2 — Invoice Details

**Session summary bar at top** (always visible in Step 2 and 3):
- Class name, date, time
- Location
- Spots remaining
- `"Change class"` link → back to Step 1

**Form fields:**

**Invoice type toggle:** Individual / Group (pill toggle, default: Individual)

**Individual fields:**
- Recipient full name (required)
- Recipient email (required)

**Group fields (shown when Group selected):**
- Company name (required)
- Contact name (required) — the person at the company receiving the invoice
- Contact email (required)

**Shared fields:**
- Number of students (required)
  - Min: 1
  - Max: `session.spotsRemaining`
  - If student count exceeds spots remaining: inline error `"Only [n] spots available for this class."`
- Price:
  - Auto-calculated: `class_types.price × student_count` — shown as default
  - `"Use custom price"` toggle below the calculated price
  - When toggled on: number input for custom total amount
  - $0 is allowed — no minimum
  - Label: `"Total amount to invoice"`
- Custom note (optional) — textarea, max 500 chars
  - Placeholder: `"e.g. Corporate rate agreed, includes all 10 staff members"`

**`"Next: Review →"` button** — disabled until all required fields are valid.

---

## Step 3 — Review & Send

Full preview of the invoice before sending.

**Preview card:**
```
INVOICE
Invoice #: [auto-generated preview — shows "Will be assigned on send"]

To: [recipient name]
    [recipient email]
    [company name if group]

Class: [class type name]
Date:  [formatted date and time]
Location: [full address]

Students: [count]
Amount:   $[total] [custom price badge if applicable]

Note: [custom note if provided]

Payment via: [platform badge]
```

**Back button:** `"← Edit Details"` — returns to Step 2 with all fields preserved.

**Send button:** `"Send Invoice"` — calls the create invoice API route.

**Sending state:** Button shows `"Sending..."` and is disabled. Do not show a spinner library — just change the button text.

---

## Create Invoice API Route

**File:** `app/api/invoices/create/route.ts`

```typescript
export async function POST(request: Request) {
  const supabase = createClient()
  const body = await request.json()

  const {
    sessionId,
    instructorId,
    invoiceType,
    recipientName,
    recipientEmail,
    companyName,
    studentCount,
    customPrice,
    totalAmount,
    amountPerStudent,
    notes,
  } = body

  // Step 1: Verify spots still available (re-check at send time)
  const { data: session } = await supabase
    .from('class_sessions')
    .select(`
      max_capacity,
      bookings ( id, cancelled ),
      invoices ( id, student_count, status )
    `)
    .eq('id', sessionId)
    .single()

  const activeBookings = session.bookings.filter(b => !b.cancelled).length
  const activeInvoiceStudents = session.invoices
    .filter(inv => inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + inv.student_count, 0)
  const spotsRemaining = session.max_capacity - activeBookings - activeInvoiceStudents

  if (studentCount > spotsRemaining) {
    return Response.json(
      { success: false, error: `Only ${spotsRemaining} spots available. Please reduce the student count.` },
      { status: 409 }
    )
  }

  // Step 2: Generate invoice number
  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })

  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(5, '0')}`

  // Step 3: Create invoice on payment platform
  // (Platform-specific API calls — similar pattern to cancellation route)
  // Get instructor's active payment account
  // Create invoice on their platform
  // Store platform_invoice_id

  // Step 4: Insert invoice record
  const { data: invoice } = await supabase
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      class_session_id: sessionId,
      instructor_id: instructorId,
      invoice_type: invoiceType,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      company_name: companyName ?? null,
      student_count: studentCount,
      amount_per_student: amountPerStudent,
      custom_price: customPrice,
      total_amount: totalAmount,
      payment_platform: paymentAccount.platform,
      platform_invoice_id: platformInvoiceId,
      notes: notes ?? null,
      status: 'sent',
    })
    .select('id, invoice_number')
    .single()

  // Step 5: Log activity
  await supabase.from('invoice_activity_log').insert({
    invoice_id: invoice.id,
    actor_id: userId,
    action: 'created',
  })

  // Step 6: Send invoice email via Resend
  // For group invoices: include /submit-roster link and instructions
  await sendInvoiceEmail({
    invoiceNumber: invoice.invoice_number,
    recipientName,
    recipientEmail,
    invoiceType,
    companyName,
    studentCount,
    totalAmount,
    className: sessionDetails.className,
    classDate: sessionDetails.startsAt,
    locationAddress: sessionDetails.locationAddress,
    notes,
    paymentLink: platformPaymentLink,
    sessionId, // for roster upload link on group invoices
  })

  return Response.json({ success: true, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number })
}
```

**Group invoice email note:**
When `invoiceType === 'group'`, include the roster upload section in the email:

```
---
SUBMITTING YOUR STUDENT ROSTER

If you have a list of staff attending this class, you can submit it in advance 
to save time on class day. This is only needed if you have multiple attendees 
and want to pre-register them.

Your invoice number: INV-00042
[Submit Your Roster →] (link to /submit-roster?invoice=INV-00042)

Note: Individual students do not need to submit a roster.
---
```

---

## Success State

After successful send, replace the form with:
- Green checkmark icon
- `"Invoice sent!"`
- `"Invoice [invoice_number] has been sent to [recipient_email]."`
- Two links:
  - `"View invoice"` → `/admin/invoices/[id]`
  - `"Send another invoice"` → `/admin/invoices/new`

---

## Responsive

- Mobile: Single column. Step indicator compact.
- Desktop: Max width `2xl` centered. Session summary bar stays visible.

---

## Accessibility

- All form inputs must have `<label>` elements
- Required fields must have `required` and `aria-required="true"`
- Step indicator must have `aria-label="Invoice creation progress"`
- Current step must have `aria-current="step"`
- Error messages must use `role="alert"`

---

## What NOT to Do

- Do not allow invoice creation without an active payment account (except super admin)
- Do not allow student count to exceed spots remaining
- Do not use a minimum price — $0 invoices are valid
- Do not auto-generate invoice number client-side — generate server-side on submit
- Do not include roster upload link in individual invoice emails
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Future — Onboarding Flow

When a super admin invites a new instructor, an onboarding flow will walk them through connecting their payment account. This flow does not exist yet. The `/admin/settings/payment` page is the current entry point for connecting payment accounts.

Leave a `// TODO: link from staff onboarding flow` comment in the payment account gate component.

---

## Definition of Done

- [ ] Payment account gate blocks instructors without active account
- [ ] Super admins bypass payment account gate
- [ ] `?session=[id]` pre-selects session and skips Step 1
- [ ] Session list shows spots remaining with correct color coding
- [ ] Sessions with 0 spots are disabled and cannot be selected
- [ ] Step 2 form validates all required fields
- [ ] Student count cannot exceed spots remaining
- [ ] Custom price toggle works — $0 allowed
- [ ] Group invoice shows company name and contact fields
- [ ] Group invoice shows roster upload section in email
- [ ] Step 3 shows full invoice preview
- [ ] Invoice number auto-generated server-side
- [ ] Spots re-verified at submit time
- [ ] Invoice created in DB with correct fields
- [ ] Activity log entry created
- [ ] Invoice email sent via Resend
- [ ] Success state shown after send
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
