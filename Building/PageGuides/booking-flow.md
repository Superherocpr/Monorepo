# Booking Flow Build Guide
**Routes:** `/book`, `/book/signin`, `/book/details`, `/book/create-account`, `/book/payment`, `/book/confirmation`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the complete multi-step booking flow for **Superhero CPR**. This is the most critical user journey on the entire site — it handles class selection, account creation, PayPal payment, and booking confirmation.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **PayPal JS SDK** — for checkout button rendering
- **Resend** — for transactional emails

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching or insert logic. Do not guess at table or column names.

Install the following if not already present:
```bash
npm install resend @paypal/react-paypal-js
```

---

## Architecture Overview

The booking flow is a **5-step linear wizard** with two possible paths through steps 2 and 3:

```
Step 1: /book                    → Select session
        ↓
Step 2a: /book/signin            → Existing customer signs in → jumps to Step 4
        OR
Step 2b: /book/details           → New customer enters info
        ↓
Step 3:  /book/create-account    → New customer chooses password → account created → welcome email sent
        ↓
Step 4:  /book/payment           → PayPal checkout
        ↓
Step 5:  /book/confirmation      → Booking confirmed (only reached after PayPal webhook)
```

### State Management — sessionStorage

State is persisted in `sessionStorage` across steps. Define a single typed store in `lib/booking-store.ts`.

All steps read from and write to this store. The store is cleared on confirmation or if the user abandons the flow.

```typescript
// lib/booking-store.ts

export interface BookingStore {
  sessionId: string | null        // Selected class_session.id
  sessionDetails: {               // Denormalized for display — avoids re-fetching
    className: string
    instructorName: string
    startsAt: string
    endsAt: string
    locationName: string
    locationAddress: string
    locationCity: string
    locationState: string
    locationZip: string
    price: number
    spotsRemaining: number
  } | null
  customerDetails: {              // Step 2b form data
    firstName: string
    lastName: string
    email: string
    phone: string
    address: string
    city: string
    state: string
    zip: string
  } | null
  isNewCustomer: boolean          // true = went through 2b/3, false = signed in via 2a
  customerId: string | null       // Set after account creation or sign-in
}

const STORE_KEY = 'superhero_cpr_booking'

export function getBookingStore(): BookingStore {
  if (typeof window === 'undefined') return emptyStore()
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) : emptyStore()
  } catch {
    return emptyStore()
  }
}

export function setBookingStore(data: Partial<BookingStore>): void {
  if (typeof window === 'undefined') return
  const current = getBookingStore()
  sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...current, ...data }))
}

export function clearBookingStore(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(STORE_KEY)
}

function emptyStore(): BookingStore {
  return {
    sessionId: null,
    sessionDetails: null,
    customerDetails: null,
    isNewCustomer: false,
    customerId: null,
  }
}
```

### Guard Logic

Every step after Step 1 must guard against missing required state. If a user navigates directly to `/book/payment` without completing prior steps, redirect them to `/book`.

Each page checks its required state on mount using `useEffect`:

```typescript
useEffect(() => {
  const store = getBookingStore()
  if (!store.sessionId) {
    router.replace('/book')
    return
  }
  // Step-specific guards below
}, [])
```

### Progress Indicator

All steps share a progress bar component showing which step the customer is on. Build this as a shared component at `app/(public)/book/_components/BookingProgress.tsx`.

```typescript
interface BookingProgressProps {
  currentStep: 1 | 2 | 3 | 4 | 5
}
```

Display as a horizontal step bar with labels: Select → Your Details → Account → Payment → Confirmation. Active step is red. Completed steps have a checkmark. Future steps are gray.

---

## Step 1 — Select a Session

**File:** `app/(public)/book/page.tsx`
**Type:** Hybrid — server component wraps a client component

### Server component responsibilities
Fetch sessions and class types. Must filter by `approval_status = 'approved'` — only approved sessions are bookable.

```typescript
// CRITICAL: Filter by approval_status = 'approved'
// Sessions pending approval or rejected are not publicly bookable
const { data: sessions } = await supabase
  .from('class_sessions')
  .select(`
    id, starts_at, ends_at, max_capacity, status,
    class_types ( id, name, price, duration_minutes ),
    profiles ( first_name, last_name ),
    locations ( name, address, city, state, zip ),
    bookings ( id, cancelled ),
    invoices ( id, student_count, status )
  `)
  .eq('status', 'scheduled')
  .eq('approval_status', 'approved')
  .gte('starts_at', new Date().toISOString())
  .order('starts_at', { ascending: true })

// Only show active class types in filter pills
const { data: classTypes } = await supabase
  .from('class_types')
  .select('id, name')
  .eq('active', true)
  .order('name')
```

Compute `spotsRemaining` — subtract both bookings AND active invoice students:

```typescript
const sessionsWithAvailability = (sessions ?? []).map(session => {
  const activeBookings = (session.bookings ?? []).filter(b => !b.cancelled).length
  const invoiceStudents = (session.invoices ?? [])
    .filter(inv => inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + inv.student_count, 0)
  const spotsRemaining = session.max_capacity - activeBookings - invoiceStudents
  return { ...session, spotsRemaining, isFull: spotsRemaining <= 0 }
})
```

Pass to client component. Also read `searchParams.session` and `searchParams.class` — pass as props.

### Client component — `BookSessionSelector.tsx`

**Props:**
```typescript
interface BookSessionSelectorProps {
  sessions: ScheduleSession[]
  classTypes: ClassTypeOption[]
  preSelectedSessionId?: string | null
  preSelectedClassSlug?: string | null
}
```

**Layout:**
- `BookingProgress` at the top (step 1 active)
- Heading: `"Choose Your Class"`
- Class type filter pills (same as schedule page)
- Session cards (same as schedule page but with "Select" button instead of "Book Now")
- If `preSelectedSessionId` is present, auto-select that session on mount

**On session select:**
1. Compute `spotsRemaining` — if 0, show an error toast and do not proceed
2. Write to store:
```typescript
setBookingStore({
  sessionId: session.id,
  sessionDetails: {
    className: session.class_types.name,
    instructorName: `${session.profiles.first_name} ${session.profiles.last_name}`,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    locationName: session.locations.name,
    locationAddress: session.locations.address,
    locationCity: session.locations.city,
    locationState: session.locations.state,
    locationZip: session.locations.zip,
    price: session.class_types.price,
    spotsRemaining,
  }
})
```
3. Check if user is already signed in via Supabase `getUser()`:
   - If signed in → write `customerId` and `isNewCustomer: false` to store → navigate to `/book/payment`
   - If not signed in → navigate to `/book/signin`

---

## Step 2a — Sign In

**File:** `app/(public)/book/signin/page.tsx`
**Type:** Client component

**Guard:** Redirect to `/book` if `store.sessionId` is null.

**Layout:**
- `BookingProgress` (step 2 active)
- Order summary sidebar (right on desktop, top on mobile) — shows selected class, date, time, location, price. Pulled from `store.sessionDetails`.
- Sign in form (left on desktop):
  - Email input
  - Password input
  - `"Sign In"` button
  - Link: `"Don't have an account? Continue as new customer"` → `/book/details`

**On sign in:**
```typescript
const { data, error } = await supabase.auth.signInWithPassword({ email, password })
if (error) { /* show inline error */ return }
setBookingStore({ customerId: data.user.id, isNewCustomer: false })
router.push('/book/payment')
```

**Inline errors:** Show field-level error messages — never use `alert()`.

---

## Step 2b — Your Details

**File:** `app/(public)/book/details/page.tsx`
**Type:** Client component

**Guard:** Redirect to `/book` if `store.sessionId` is null.

**On mount:** Pre-populate form fields from `store.customerDetails` if they exist (supports back navigation from Step 3).

**Layout:**
- `BookingProgress` (step 2 active)
- Order summary sidebar
- Details form:
  - First name (required)
  - Last name (required)
  - Email (required)
  - Phone (required)
  - Address (required) — label note: `"Used for your certification record"`
  - City (required)
  - State (required) — dropdown of US states
  - Zip (required)
  - `"Continue"` button

**Duplicate detection:**
Before navigating to Step 3, check if the email already exists:
```typescript
const { data: existing } = await supabase
  .from('profiles')
  .select('id')
  .eq('email', formData.email)
  .maybeSingle()

if (existing) {
  // Show inline message:
  // "An account with this email already exists. Please sign in instead."
  // Include a link to /book/signin
  return
}
```

**On continue (no duplicate):**
```typescript
setBookingStore({ customerDetails: formData, isNewCustomer: true })
router.push('/book/create-account')
```

---

## Step 3 — Create Account

**File:** `app/(public)/book/create-account/page.tsx`
**Type:** Client component

**Guards:**
- Redirect to `/book` if `store.sessionId` is null
- Redirect to `/book/details` if `store.customerDetails` is null

**On mount:** Display the customer's name and email from `store.customerDetails` so they can confirm it's correct.

**Layout:**
- `BookingProgress` (step 3 active)
- Order summary sidebar
- Confirmation display: `"Creating account for [firstName] [lastName] ([email])"`
- Back link: `"← Edit your details"` → `/book/details`
- Password form:
  - Password input (min 8 characters)
  - Confirm password input
  - Password strength indicator (simple: weak / good / strong based on length + character variety)
  - `"Create Account & Continue"` button

**On submit:**
```typescript
// 1. Create Supabase auth user
const { data: authData, error: authError } = await supabase.auth.signUp({
  email: store.customerDetails.email,
  password,
})
if (authError) { /* show error */ return }

// 2. Insert profile record
const { error: profileError } = await supabase
  .from('profiles')
  .insert({
    id: authData.user!.id,
    first_name: store.customerDetails.firstName,
    last_name: store.customerDetails.lastName,
    email: store.customerDetails.email,
    phone: store.customerDetails.phone,
    address: store.customerDetails.address,
    city: store.customerDetails.city,
    state: store.customerDetails.state,
    zip: store.customerDetails.zip,
    role: 'customer',
  })
if (profileError) { /* show error */ return }

// 3. Send welcome email via API route
await fetch('/api/emails/welcome', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstName: store.customerDetails.firstName,
    email: store.customerDetails.email,
  }),
})

// 4. Update store
setBookingStore({ customerId: authData.user!.id })

// 5. Navigate to payment
router.push('/book/payment')
```

---

## API Route — Welcome Email

**File:** `app/api/emails/welcome/route.ts`

```typescript
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: Request) {
  const { firstName, email } = await request.json()

  await resend.emails.send({
    from: 'Superhero CPR <noreply@superherocpr.com>',
    to: email,
    subject: 'Welcome to Superhero CPR!',
    html: `
      <h1>Welcome, ${firstName}!</h1>
      <p>Your Superhero CPR account has been created successfully.</p>
      <p>You can now book classes, view your certifications, and manage your account at <a href="https://superherocpr.com/dashboard">superherocpr.com</a>.</p>
      <p>See you in class!</p>
      <p>— The Superhero CPR Team</p>
    `,
  })

  return Response.json({ success: true })
}
```

---

## Step 4 — Payment

**File:** `app/(public)/book/payment/page.tsx`
**Type:** Client component

**Guards:**
- Redirect to `/book` if `store.sessionId` is null
- Redirect to `/book/details` if `store.customerId` is null

**Layout:**
- `BookingProgress` (step 4 active)
- Order summary (prominent, full details):
  - Class name
  - Date and time
  - Instructor name
  - Full location address
  - Price — large, bold
- PayPal button section below the order summary

**PayPal Integration:**

```typescript
<PayPalScriptProvider options={{
  clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID!,
  currency: 'USD',
}}>
  <PayPalButtons
    style={{ layout: 'vertical', color: 'gold', shape: 'rect' }}
    createOrder={(data, actions) => {
      return actions.order.create({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            value: store.sessionDetails!.price.toFixed(2),
            currency_code: 'USD',
          },
          description: `Superhero CPR — ${store.sessionDetails!.className}`,
        }],
      })
    }}
    onApprove={async (data, actions) => {
      const order = await actions.order!.capture()
      const response = await fetch('/api/bookings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paypalOrderId: order.id,
          paypalTransactionId: order.purchase_units[0].payments?.captures?.[0]?.id,
          sessionId: store.sessionId,
          customerId: store.customerId,
          amount: store.sessionDetails!.price,
          customerEmail: store.customerDetails?.email,
          customerFirstName: store.customerDetails?.firstName,
          className: store.sessionDetails!.className,
          startsAt: store.sessionDetails!.startsAt,
          locationName: store.sessionDetails!.locationName,
          locationAddress: store.sessionDetails!.locationAddress,
          locationCity: store.sessionDetails!.locationCity,
          locationState: store.sessionDetails!.locationState,
          locationZip: store.sessionDetails!.locationZip,
        }),
      })
      const result = await response.json()
      if (result.success) {
        router.push('/book/confirmation')
      } else {
        // Show error — booking creation failed despite payment
        // Log this prominently — manual intervention may be needed
      }
    }}
    onError={(err) => {
      console.error('PayPal error:', err)
      // Show user-facing error message
    }}
  />
</PayPalScriptProvider>
```

**Important:** Do not redirect to confirmation from `onApprove` directly. Always go through the `/api/bookings/confirm` API route first.

---

## API Route — Confirm Booking

**File:** `app/api/bookings/confirm/route.ts`

This is the most critical API route in the entire application. It must:
1. Re-verify spots availability (first-come-first-served)
2. Create the booking record
3. Create the payment record
4. Send the payment receipt / booking confirmation email
5. Return success or failure

```typescript
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

interface BookingRecord {
  id: string
  cancelled: boolean
}

interface InvoiceRecord {
  id: string
  student_count: number
  status: string
}

export async function POST(request: Request) {
  const supabase = createClient()
  const body = await request.json()

  const {
    paypalTransactionId,
    sessionId,
    customerId,
    amount,
    customerEmail,
    customerFirstName,
    className,
    startsAt,
    locationName,
    locationAddress,
    locationCity,
    locationState,
    locationZip,
  } = body

  // Step 1: Re-verify availability
  // Count both bookings AND active invoice students — invoices reserve spots
  const { data: session } = await supabase
    .from('class_sessions')
    .select(`
      max_capacity,
      bookings ( id, cancelled ),
      invoices ( id, student_count, status )
    `)
    .eq('id', sessionId)
    .single()

  if (!session) {
    return Response.json({ success: false, error: 'Session not found' }, { status: 404 })
  }

  const activeBookings = (session.bookings as BookingRecord[])
    .filter(b => !b.cancelled).length

  const invoiceStudents = (session.invoices as InvoiceRecord[])
    .filter(inv => inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + inv.student_count, 0)

  const totalSpotsTaken = activeBookings + invoiceStudents

  if (totalSpotsTaken >= session.max_capacity) {
    return Response.json({ success: false, error: 'Class is now full' }, { status: 409 })
  }

  // Step 2: Create booking record
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      session_id: sessionId,
      customer_id: customerId,
      booking_source: 'online',
      cancelled: false,
    })
    .select('id')
    .single()

  if (bookingError || !booking) {
    return Response.json({ success: false, error: 'Failed to create booking' }, { status: 500 })
  }

  // Step 3: Create payment record
  await supabase
    .from('payments')
    .insert({
      customer_id: customerId,
      booking_id: booking.id,
      amount,
      status: 'completed',
      payment_type: 'online',
      paypal_transaction_id: paypalTransactionId,
    })

  // Step 4: Send payment receipt + booking confirmation email
  const formattedDate = new Date(startsAt).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const formattedTime = new Date(startsAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  await resend.emails.send({
    from: 'Superhero CPR <noreply@superherocpr.com>',
    to: customerEmail,
    subject: `Booking Confirmed — ${className} on ${formattedDate}`,
    html: `
      <h1>You're booked!</h1>
      <p>Hi ${customerFirstName},</p>
      <p>Your booking for <strong>${className}</strong> has been confirmed. Here are your details:</p>
      <table>
        <tr><td><strong>Class:</strong></td><td>${className}</td></tr>
        <tr><td><strong>Date:</strong></td><td>${formattedDate}</td></tr>
        <tr><td><strong>Time:</strong></td><td>${formattedTime}</td></tr>
        <tr><td><strong>Location:</strong></td><td>${locationName}<br>${locationAddress}<br>${locationCity}, ${locationState} ${locationZip}</td></tr>
        <tr><td><strong>Amount paid:</strong></td><td>$${amount.toFixed(2)}</td></tr>
        <tr><td><strong>Transaction ID:</strong></td><td>${paypalTransactionId}</td></tr>
      </table>
      <p>Please arrive a few minutes early. Wear comfortable clothing.</p>
      <p>Questions? Reply to this email or call us at (813) 966-3969.</p>
      <p>See you in class!<br>— The Superhero CPR Team</p>
    `,
  })

  return Response.json({ success: true, bookingId: booking.id })
}
```

**Error handling — class is now full:**
If the re-verification check fails, return a `409` response. Show the user: `"We're sorry — this class just filled up while you were checking out. Your payment has not been charged. Please select another session."` Clear the session from the store and redirect to `/book`.

Note: PayPal payment capture happens before this API call. If the class is full, the charge has already been captured. Add a `// TODO: implement PayPal refund flow for this case` comment.

---

## Step 5 — Confirmation

**File:** `app/(public)/book/confirmation/page.tsx`
**Type:** Client component

**Guards:**
- Redirect to `/book` if `store.sessionId` is null (someone navigated here directly)

**On mount:**
```typescript
const [details, setDetails] = useState<BookingStore['sessionDetails']>(null)

useEffect(() => {
  const store = getBookingStore()
  if (!store.sessionId) {
    router.replace('/book')
    return
  }
  setDetails(store.sessionDetails) // Capture before clearing
  clearBookingStore()
}, [])
```

**Layout:**
- `BookingProgress` (step 5 active — all steps complete)
- Large success checkmark (green)
- Heading: `"You're All Set!"`
- Subtext: `"A confirmation email has been sent to your inbox with your booking details and receipt."`
- Booking summary card
- Three action links:
  - `"View my bookings"` → `/dashboard/bookings`
  - `"Book another class"` → `/book`
  - `"Back to home"` → `/`

---

## Shared Components

All shared booking components live in `app/(public)/book/_components/`:

### `BookingProgress.tsx`
Step indicator. See Architecture section above.

### `OrderSummary.tsx`
```typescript
interface OrderSummaryProps {
  details: BookingStore['sessionDetails']
}
```
Displays: class name, date, time, instructor, location name + full address, price.

---

## Environment Variables Required

```
NEXT_PUBLIC_PAYPAL_CLIENT_ID=         # Get from PayPal Developer Dashboard
PAYPAL_SECRET=                         # Get from PayPal Developer Dashboard
RESEND_API_KEY=                        # Get from resend.com dashboard
```

---

## Routing & Navigation Rules

- Always use `router.push()` for forward navigation
- Always use `router.replace()` for guard redirects
- Never use `<a>` tags for inter-step navigation

---

## Responsive Breakpoints

- Mobile (< `lg`): Single column. Order summary appears above the form.
- Desktop (`lg`+): Two columns. Order summary in right sidebar, form on left.

Every step must be fully responsive from 375px to 1440px.

---

## Accessibility Requirements

- All form inputs must have associated `<label>` elements
- Required fields must have `required` attribute and `aria-required="true"`
- Inline errors must use `role="alert"`
- Password strength indicator: `aria-live="polite"` on the strength text
- Progress bar: `aria-label="Booking progress"` and `aria-current="step"` on active step

---

## What NOT to Do

- Do not create the booking record before PayPal confirms — only in `/api/bookings/confirm`
- Do not redirect to confirmation directly from `onApprove` — always go through the API route
- Do not skip the re-verification check — spots must be re-checked including invoice students
- Do not show sessions without `approval_status = 'approved'`
- Do not use `any` TypeScript types — define proper interfaces for all DB response shapes
- Do not use inline styles — Tailwind only
- Do not skip the welcome email on account creation
- Do not skip the confirmation email on payment

---

## Definition of Done

- [ ] Step 1: Sessions query filters by BOTH `status = 'scheduled'` AND `approval_status = 'approved'`
- [ ] Step 1: Spots remaining accounts for bookings AND active invoice student counts
- [ ] Step 1: Sessions load, pre-selection from `?session=` works, already-signed-in users skip to payment
- [ ] Step 2a: Sign in works, failed sign-in shows inline error, store updated on success
- [ ] Step 2b: Form validates, duplicate email check works with helpful message, back nav pre-populates
- [ ] Step 3: Account created in Supabase auth + profiles table, welcome email sent via Resend
- [ ] Step 4: PayPal button renders, order details correct, `onApprove` calls API route
- [ ] API route: Re-verifies availability counting both bookings AND invoice students
- [ ] API route: No `any` TypeScript types — `BookingRecord` and `InvoiceRecord` interfaces defined
- [ ] API route: Returns 409 with helpful message if class filled up during checkout
- [ ] Step 5: Store cleared on mount, details captured before clearing, confirmation displayed
- [ ] Order summary visible on steps 2–4 with correct details
- [ ] Progress bar shows correct step on every page
- [ ] All guards redirect correctly when required state is missing
- [ ] Welcome email sent on account creation
- [ ] Confirmation email sent with receipt and booking details after payment
- [ ] Fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
