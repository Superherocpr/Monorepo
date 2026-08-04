# Roster Correction Build Guide
**Route:** `/roster/[session_token]`
**File:** `app/(public)/roster/[session_token]/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/roster/[session_token]` page for **Superhero CPR**. This is a public page — no login required — where students confirm or correct their personal information after a manager has imported a roster for their class. Students access this page on class day via a URL displayed by the instructor. A correction window closes 30 minutes after class start.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

This page is public — no auth guard.

---

## Key Design Principle — Booking Records

Students on the roster were imported from a company spreadsheet submitted via `/submit-roster`. They have a `roster_record` but may not have a `booking` record yet. **This page is responsible for creating their booking record** when they confirm their information.

Contrast with rollcall (`/rollcall`) — rollcall students already paid and have bookings. Roster correction students were on a company group booking and their individual booking records need to be created here.

---

## Page Design

Used on mobile in a classroom setting:
- Large tap targets
- Minimal typing required
- Clear confirmation feedback
- Clean, focused UI — not styled like the public website

---

## Architecture

Hybrid — server verifies the session token and checks the correction window. If valid, renders the client component for student interaction.

---

## Server-Side Checks

```typescript
const { data: session } = await supabase
  .from('class_sessions')
  .select(`
    id, starts_at, correction_window_closes_at, roster_imported,
    class_types ( name ),
    locations ( name )
  `)
  .eq('session_token', params.session_token)
  .single()
```

**Invalid token:** If no session found:
```
"This link is not valid. Please ask your instructor for the correct link."
```

**Roster not imported:** If `roster_imported = false`:
```
"The roster for this class hasn't been set up yet. Please check back later or ask your instructor."
```

**Correction window closed:** If `correction_window_closes_at` is in the past:
```
"The correction window for this class has closed."
Class: [class type name]
Date: [formatted date]
"If you need to make a change, please contact your instructor."
```

If all checks pass: render the student lookup UI.

---

## Student Lookup

Students find themselves by name. No login required.

**UI:**
- Heading: `"[Class Type Name]"` + date/time
- Subtext: `"Find your name below to confirm or correct your information."`
- Search input — `"Search by first or last name..."`
- Filtered list of roster records for this session as the student types

**Each result in the list shows:**
- First name, last name
- Employer (if available) — helps distinguish duplicates

**Tap to select** — opens the student's record.

---

## Device Token Locking

When a student taps their record for the first time:
- Client generates a UUID and stores it in `localStorage`
- On first tap: send the token to the server, store in `roster_records.device_token`
- On subsequent visits: device_token in localStorage must match the DB

**Device tokens don't match:**
```
"This record has already been confirmed from another device.
 If this was you, you're all set. If not, please speak to your instructor."
```

**First interaction** (device_token is null in DB): allow access and set the token.

---

## Student Record View / Edit

Once a student selects their record:

**Fields shown:**
- First name (editable)
- Last name (editable)
- Email (editable — required for account creation)
- Phone (editable)
- Employer (editable)

**Two action buttons:**
- `"Everything looks correct"` — confirms without changes
- `"Update my information"` — opens edit mode

### Edit Mode

All fields become editable inline. Student updates what they need.

`"Save & Confirm"` button saves changes and confirms.

---

## On Confirm — API Route `PATCH /api/roster/confirm`

```typescript
// Body: { recordId, deviceToken, updates: { firstName, lastName, email, phone, employer } }

export async function PATCH(request: Request) {
  const supabase = createClient()
  const { recordId, deviceToken, updates } = await request.json()

  // 1. Fetch roster record and session
  const { data: record } = await supabase
    .from('roster_records')
    .select('id, session_id, booking_id, email, device_token, confirmed')
    .eq('id', recordId)
    .single()

  // 2. Verify device token
  if (record.device_token && record.device_token !== deviceToken) {
    return Response.json({ success: false, error: 'Device mismatch.' }, { status: 403 })
  }

  // 3. Verify correction window still open
  const { data: session } = await supabase
    .from('class_sessions')
    .select('correction_window_closes_at')
    .eq('id', record.session_id)
    .single()

  if (new Date(session.correction_window_closes_at) < new Date()) {
    return Response.json({ success: false, error: 'Correction window closed.' }, { status: 403 })
  }

  // 4. Detect if any fields changed
  const hasChanges = (
    updates.firstName !== record.first_name ||
    updates.lastName !== record.last_name ||
    updates.email !== record.email ||
    updates.phone !== record.phone ||
    updates.employer !== record.employer
  )

  // 5. Update roster record
  await supabase
    .from('roster_records')
    .update({
      first_name: updates.firstName,
      last_name: updates.lastName,
      email: updates.email,
      phone: updates.phone || null,
      employer: updates.employer || null,
      confirmed: true,
      corrected: hasChanges,
      device_token: deviceToken,
      updated_at: new Date().toISOString(),
    })
    .eq('id', recordId)

  // 6. Create booking record if one doesn't exist yet
  if (!record.booking_id && updates.email) {
    // Find or create a customer profile for this email
    let customerId: string | null = null

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', updates.email)
      .maybeSingle()

    if (existingProfile) {
      customerId = existingProfile.id
    }
    // Note: if no profile exists, booking_id remains null until the student
    // creates an account via rollcall or the customer portal.
    // The roster_record is still confirmed — grading will work regardless.

    if (customerId) {
      const { data: newBooking } = await supabase
        .from('bookings')
        .insert({
          session_id: record.session_id,
          customer_id: customerId,
          booking_source: 'invoice', // came through group invoice flow
        })
        .select('id')
        .single()

      // Link booking to roster record
      await supabase
        .from('roster_records')
        .update({ booking_id: newBooking.id })
        .eq('id', recordId)
    }
  }

  return Response.json({ success: true })
}
```

---

## Confirmation State

After confirming:

**UI:**
- Large green checkmark
- Heading: `"You're all set!"`
- Subtext: `"Your information has been confirmed for [Class Type] on [date]."`
- Their final confirmed details shown below

Student puts phone away.

---

## Already Confirmed State

If a student revisits (same device):

- Show their confirmed record with green `"Confirmed"` badge
- Heading: `"Already confirmed"`
- Show their details
- `"Need to make a change?"` — reopens edit mode if window still open

---

## Edge Cases

**Student not on the roster:**
Show at the bottom of the search results list:
```
"Don't see your name? Your instructor can add you.
 Alternatively, go to superherocpr.com/rollcall to check in."
```

**Correction window closes while student is editing:**
Re-check on save server-side. If closed:
```
"The correction window has just closed. Your changes could not be saved.
 Please speak to your instructor."
```

---

## Summary — What This Page Creates

| Scenario | Creates booking? | Updates roster_record? |
|---|---|---|
| Student confirms, has an account | Yes — links to existing customer | Yes — confirmed = true |
| Student confirms, no account yet | No — booking_id stays null until they create account | Yes — confirmed = true |
| Student corrects info | Same as above | Yes — confirmed + corrected = true |

---

## Responsive

Mobile-first. Max width `sm` centered on desktop.

---

## What NOT to Do

- Do not require login — fully public
- Do not allow editing after correction window closes — check server-side on every save
- Do not allow a second device to take over a locked record
- Do not show other students' full details in search results — name and employer only
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Invalid session token shows friendly error
- [ ] Roster not imported shows appropriate message
- [ ] Closed correction window shows appropriate message
- [ ] Student name search filters roster records in real time
- [ ] Selecting a record checks and sets device token correctly
- [ ] Device token mismatch shows appropriate message
- [ ] Confirm without changes sets `confirmed = true`
- [ ] Edit mode allows updating all fields
- [ ] Save sets `confirmed = true` and `corrected = true` if fields changed
- [ ] Booking record created and linked if customer account exists
- [ ] Booking record NOT created if no account exists — roster_record confirmed regardless
- [ ] Server re-checks correction window on every save
- [ ] Confirmation state shows final details with green checkmark
- [ ] Already confirmed state shown on revisit (same device)
- [ ] Student not found message at bottom of empty search
- [ ] Mobile-first design
- [ ] No TypeScript errors
- [ ] No ESLint errors
