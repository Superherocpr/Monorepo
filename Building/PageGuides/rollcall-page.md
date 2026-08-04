# Rollcall Build Guide
**Route:** `/rollcall`
**File:** `app/(public)/rollcall/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/rollcall` page for **Superhero CPR**. This is a public page — no login required — where students identify themselves on class day. Students have already paid before arriving (via online booking or invoice). They already have a `booking` record. Rollcall does NOT create new booking records — it creates a `roster_record` so the instructor can find and grade them.

The instructor announces their 6-digit daily access code verbally at the start of class. Students enter it here to check in.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for welcome email (new accounts only)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

This page is public — no auth guard.

---

## Key Design Principle

**All students at rollcall already have a booking.** They paid online or via invoice before arriving. Rollcall's job is to:
1. Identify who they are (account lookup or new account creation)
2. Create a `roster_record` so the instructor can grade them
3. Link the roster_record to their existing booking

Do NOT create a new `booking` record in this flow.

---

## Page Design

This page is used on mobile phones in a classroom setting:
- Large tap targets
- Minimal text entry
- Clear feedback at every step
- No distractions — focused single-purpose UI
- Not styled like the public website — clean, functional, mobile-first

---

## Architecture

Fully client component. Multi-step flow managed in local state. No page reloads between steps.

---

## Step Flow

```
Step 1 — Enter access code
    ↓ code valid
Step 2 — Select class (if instructor has multiple today)
    ↓ (skip if only one class today)
Step 3 — Enter email
    ↓ email exists in system    ↓ email not in system
Step 4a — Sign in             Step 4b — Create account
    ↓                              ↓
Step 5 — Confirmation (roster_record created)
```

---

## Step 1 — Enter Access Code

**UI:**
- Heading: `"Welcome to class!"`
- Subtext: `"Enter the code your instructor gave you."`
- 6-digit code input — large font, centered, numeric keyboard on mobile (`inputMode="numeric"`)
- Auto-submits when 6 digits entered (no submit button needed)

**On code entry — `POST /api/rollcall/verify-code`:**
```typescript
// Body: { code: string }
// Returns: { valid: boolean, instructorId: string, instructorName: string, sessions: Session[] }
```

Look up `profiles` where `daily_access_code = code` and `role = 'instructor'`.

If valid: advance to Step 2 (or skip to Step 3 if only one session today).
If invalid: show error inline — `"That code doesn't match. Check with your instructor."` — clear input, let them try again.

---

## Step 2 — Select Class

Only shown if the instructor has more than one approved session today.

**UI:**
- Heading: `"Which class are you attending?"`
- List of today's approved sessions for this instructor
- Each option shows: class type name, start time, location name
- Tap to select — no confirm button needed

---

## Step 3 — Enter Email

**UI:**
- Heading: `"What's your email address?"`
- Email input — large, full width
- `"Continue"` button

**On submit — `POST /api/rollcall/check-email`:**
```typescript
// Body: { email: string, sessionId: string }
// Returns: { exists: boolean, firstName?: string, hasBooking: boolean }
```

Checks:
1. Does a profile exist with this email?
2. Does that profile have a non-cancelled booking for this session?

- If profile exists: advance to Step 4a (sign in)
- If no profile: advance to Step 4b (create account)

---

## Step 4a — Returning Student Sign In

Student already has an account.

**UI:**
- Heading: `"Welcome back, [firstName]!"`
- Subtext: `"Enter your password to check in."`
- Password input
- `"Check In"` button
- `"Forgot password?"` link → `/book/forgot-password`

**On submit — `POST /api/rollcall/checkin`:**

```typescript
export async function POST(request: Request) {
  const supabase = createClient()
  const { email, password, sessionId } = await request.json()

  // 1. Sign in to verify identity
  const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (signInError) {
    return Response.json({ success: false, error: 'Incorrect password.' }, { status: 401 })
  }

  const userId = authData.user.id

  // 2. Find their existing booking for this session
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, customer_id')
    .eq('session_id', sessionId)
    .eq('customer_id', userId)
    .eq('cancelled', false)
    .maybeSingle()

  // Note: booking should exist since they already paid
  // If somehow it doesn't, log a warning but don't block them

  // 3. Create roster_record if one doesn't already exist
  const { data: existingRecord } = await supabase
    .from('roster_records')
    .select('id')
    .eq('session_id', sessionId)
    .eq('email', email)
    .maybeSingle()

  if (!existingRecord) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, phone')
      .eq('id', userId)
      .single()

    await supabase.from('roster_records').insert({
      session_id: sessionId,
      booking_id: booking?.id ?? null,
      first_name: profile.first_name,
      last_name: profile.last_name,
      email,
      phone: profile.phone ?? null,
    })
  }

  return Response.json({ success: true })
}
```

**Already checked in:**
If a `roster_record` already exists for this session and email — skip creation and go straight to Step 5 with message: `"You're already checked in for this class!"`

---

## Step 4b — New Student Account Creation

Student has no account yet. This happens when a student was booked by a company (group invoice) and hasn't created their personal account yet.

**UI:**
- Heading: `"Let's get you set up"`
- Subtext: `"Create your account to check in and access your certifications later."`
- Fields:
  - First name (required)
  - Last name (required)
  - Phone (optional)
  - Password (required, min 8 characters) — with strength indicator
  - Confirm password (required)
- `"Create Account & Check In"` button

**On submit — `POST /api/rollcall/register`:**

```typescript
export async function POST(request: Request) {
  const supabase = createClient()
  const { firstName, lastName, email, phone, password, sessionId } = await request.json()

  // 1. Create Supabase auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  })
  if (authError || !authData.user) {
    return Response.json({ success: false, error: 'Failed to create account.' }, { status: 500 })
  }

  // 2. Insert profile
  await supabase.from('profiles').insert({
    id: authData.user.id,
    first_name: firstName,
    last_name: lastName,
    email,
    phone: phone || null,
    role: 'customer',
  })

  // 3. Find their existing booking (created when invoice was paid)
  //    Match by session_id — we can't match by customer_id yet since account just created
  //    Look for an invoice booking for this session with no customer linked
  //    This is a best-effort match — link if found, null if not
  const { data: booking } = await supabase
    .from('bookings')
    .select('id')
    .eq('session_id', sessionId)
    .eq('booking_source', 'invoice')
    .is('customer_id', null) // placeholder — see note below
    .limit(1)
    .maybeSingle()

  // NOTE: Linking new accounts to existing invoice bookings is complex because
  // invoice bookings were created with a customer_id at payment time.
  // For group invoices, bookings are created as placeholders.
  // See schema note on group invoice booking creation for exact implementation.
  // For now: create roster_record with booking_id = null if no match found.

  // 4. Create roster_record
  await supabase.from('roster_records').insert({
    session_id: sessionId,
    booking_id: booking?.id ?? null,
    first_name: firstName,
    last_name: lastName,
    email,
    phone: phone || null,
  })

  // 5. Send welcome email
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'Superhero CPR <noreply@superherocpr.com>',
    to: email,
    subject: 'Welcome to Superhero CPR!',
    html: `
      <h1>Welcome, ${firstName}!</h1>
      <p>You've been checked in for today's class. Great to have you!</p>
      <p>Your Superhero CPR account is now active. You can view your certifications
      and booking history at superherocpr.com/dashboard.</p>
      <p>— The Superhero CPR Team</p>
    `,
  })

  return Response.json({ success: true })
}
```

---

## Step 5 — Confirmation

**UI:**
- Large green checkmark
- Heading: `"You're checked in!"`
- Class details: `"[Class type] at [time] — [location name]"`
- For new accounts: `"Welcome to Superhero CPR! A welcome email is on its way."`
- For returning students: `"Good to see you again, [firstName]!"`
- No further action needed — student puts phone away

---

## What Rollcall Creates

| Student type | Creates booking? | Creates roster_record? | Welcome email? |
|---|---|---|---|
| Returning student (has account, has booking) | No | Yes (if not exists) | No |
| New student (no account yet) | No | Yes | Yes |

Rollcall never creates a `booking` record. Students already have one from paying online or via invoice.

---

## Access Code Expiry

The `daily_access_code` regenerates at midnight. This page accepts any matching code — no time window validation. The code is instructor-specific enough that accidental guessing is not a concern.

---

## Responsive

- Mobile first — almost always used on a phone in class
- Max width `sm` (384px) centered on desktop
- Large inputs, generous padding, easy tap targets

---

## What NOT to Do

- **Do NOT create a booking record** — students already have one
- Do not require login before entering the code — public page
- Do not send welcome email to returning students — new accounts only
- Do not block already-checked-in students with an error — skip and confirm
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Page is public — no auth required
- [ ] Step 1: 6-digit code input auto-submits, validates correctly
- [ ] Invalid code shows clear inline error
- [ ] Step 2: Class selection only shown when instructor has multiple sessions today
- [ ] Step 3: Email check correctly identifies new vs returning students
- [ ] Step 4a: Returning student signs in, roster_record created (not booking)
- [ ] Step 4a: Already checked-in students skip to confirmation gracefully
- [ ] Step 4b: New student creates account, roster_record created (not booking)
- [ ] Welcome email sent to new students only
- [ ] No booking records created at any point in this flow
- [ ] Step 5: Confirmation shown with class details
- [ ] Mobile-first design — large tap targets, numeric keyboard for code
- [ ] No TypeScript errors
- [ ] No ESLint errors
