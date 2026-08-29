# Admin Session Detail Build Guide
**Route:** `/admin/sessions/[id]`
**File:** `app/(admin)/sessions/[id]/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/admin/sessions/[id]` session detail page for **Superhero CPR**. This is the full view of a single class session. Content and actions adapt based on the viewer's role. This is one of the most important and complex pages in the admin.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

This page is protected by the admin layout auth guard.

---

## Data Fetching

```typescript
const { data: session } = await supabase
  .from('class_sessions')
  .select(`
    id, starts_at, ends_at, status, approval_status,
    rejection_reason, max_capacity, notes,
    enrollware_submitted, roster_imported,
    correction_window_closes_at, google_calendar_event_id,
    class_types ( id, name, price, duration_minutes ),
    profiles ( id, first_name, last_name, role ),
    locations ( name, address, city, state, zip ),
    bookings (
      id, cancelled, booking_source, grade,
      profiles ( first_name, last_name, email ),
      payments ( status, payment_type, amount )
    ),
    roster_records (
      id, first_name, last_name, email, grade, confirmed
    ),
    invoices (
      id, invoice_number, invoice_type, recipient_name,
      recipient_email, company_name, student_count,
      total_amount, status, created_at
    ),
    roster_uploads (
      id, original_filename, submitted_by_name,
      submitted_by_email, imported, created_at
    )
  `)
  .eq('id', params.id)
  .single()
```

If session not found: redirect to `/admin/sessions`.
If instructor viewing session that isn't theirs: redirect to `/admin/sessions` — EXCEPT two open cases any instructor may view:
- Unassigned customer-requested sessions (`class_request_id` set, `instructor_id` null) — claimable via "Accept to Teach"
- Open opportunities (`status = 'cancelled'`, `instructor_id` null) — cancelled sessions claimable via "Claim This Class"

---

## Page Sections

### Section 1 — Header

**Always visible to all roles.**

Displays:
- Class type name — `<h1>`
- Date, time, duration
- Instructor name
- Location — full address block
- Capacity: `"[booked] / [max] students"`

**Badges:**
- Approval status badge (amber/green/red)
- Session status badge (blue/amber/green/red)
- `enrollware_submitted` badge — green `"Submitted to Enrollware"` if true

**Actions (role-gated):**

*Approval actions — manager/super admin, only when `approval_status = 'pending_approval'`:*
- `"Approve"` button — one click, no confirmation. Sets `approval_status = 'approved'`. Sends approval email to instructor.
- `"Reject"` button — opens inline form with reason field (min 10 chars). Sets `approval_status = 'rejected'`. Sends rejection email to instructor.

*Rejection reason — shown when `approval_status = 'rejected'`:*
- For instructors: `"This session was not approved. Reason: [rejection_reason]"` in red. Below: `"Edit this session and resubmit for approval →"` — only if instructor created it and it hasn't been approved before.
- For managers/super admins: rejection reason shown as info only.

*Edit button:*
- Instructors: visible only if `approval_status !== 'approved'` AND `instructor_id = user.id`
- Managers/super admins: always visible
- Editing an approved session shows a warning: `"Editing this session will reset it to pending approval and remove it from the public schedule until re-approved."` with Confirm and Cancel buttons.
- On confirm: set `approval_status = 'pending_approval'`, save edits.

*Cancel session button — manager/super admin any time; instructor on their own session only:*
- Instructors are blocked from cancelling within 48 hours of `starts_at` — clicking Cancel inside that window shows a modal telling them to call Daniel Hedgeman directly (`OWNER_DIRECT_PHONE` in `lib/constants.ts`); no request fires. The API route (`POST /api/sessions/[id]/cancel`) re-checks the 48hr window and ownership server-side.
- Managers/super admins are never restricted by the 48hr window.
- Opens inline confirmation with reason field (min 10 chars required)
- On confirm: set `status = 'cancelled'`, `instructor_id = NULL`, `cancelled_at`, `cancelled_by`, `cancellation_reason` — the session becomes an open opportunity any instructor can claim
- Notifies admins/managers + broadcasts the opportunity to all active instructors. Booked students are NOT emailed at cancellation — they only hear about it once a new instructor claims the class.

---

### Assistant and Add-ons — Quick Actions

**Visible/editable to instructors (own session) and managers/super admins (any session).** Unlike the fields in the Edit form below, these two are **not gated by approval status** — changing either never resets an approved session back to `pending_approval`.

*Assistant:*
- Set an assistant as either another platform instructor (dropdown) or a plain free-text name — never both (`setSessionAssistant`, `assistant_instructor_id` / `assistant_name` columns)
- Instructors may only set this on their own session

*Add-ons:*
- Add or remove the add-ons offered on this session, and manage per-add-on pricing (`setSessionAddons`, replace-all against `session_addons`)
- Only add-ons already eligible for the session's class type (`addon_class_types`) may be selected — the server rejects anything else
- Instructors may only manage this on their own session

---

### Open Opportunity Banner — Claim This Class

Shown when `status = 'cancelled'` AND `instructor_id IS NULL` (amber banner, same visual language as the Accept-to-Teach banner). Any instructor/manager/super admin can claim:
- Location `<select>` (defaults to the session's last location) — the claimer picks where they'll teach from
- "Claim This Class" button → `POST /api/sessions/[id]/claim` with `{ location_id }`
- Atomic first-come-first-serve: conditional UPDATE with `WHERE instructor_id IS NULL`; a lost race returns 409 → show "This class was just claimed by another instructor."
- On success: `instructor_id` = claimer, `location_id` updated, `status` back to `'scheduled'` — no re-approval step
- Notifies booked students (new instructor name + phone + new location) and admins/managers
- If nobody claims: a pg_cron job escalates to super admins at 12am/9am/12pm/3pm/6pm/9pm Eastern once the session is within 48hrs of start (pure notification, no auto-cancel — see `notify-unclaimed-opportunities` route)

---

### Section 2 — Students

**Visible to all roles.**

Combined list of all students from `bookings` (non-cancelled) and `roster_records`.

**Columns:**
- Name
- Email
- Source badge: `online` / `invoice` / `rollcall` / `roster`
- Payment status (from bookings.payments)
- Grade (if entered)

**Actions:**
- Import Roster button → `/admin/sessions/[id]/roster` — manager/super admin only
- If a `roster_upload` exists with `imported = false`: show amber banner `"A customer roster has been submitted and is ready to import."` with Import button

**Rollcall info note** (always shown):
```
"Students register via rollcall at superherocpr.com/rollcall using the instructor's daily class code."
```

**Per-student documents (Photos button):**
- Each student row shows a photo/document count badge (e.g. `📷 2`) that opens a modal to upload, view, or delete files (photos or PDFs — e.g. signed forms, ID) for that student (`uploadStudentDocument` / `deleteStudentDocument`, `student_documents` table)
- Access: any manager, or the owning instructor on their own session (`canManagePhotos = isManager || (isInstructor && isOwnSession)`)
- These files are later merged per-student into a single PDF and can be pushed into Enrollware's Documents section by the Enrollware bookmarklet (`GET /api/enrollware/session-documents`)

---

### Section 3 — Invoices

**Visible to instructors (own session) and super admins only.**

Lists all invoices for this session. Each row shows:
- Invoice number
- Recipient name / company name
- Type badge: `individual` / `group`
- Student count
- Total amount
- Status badge: `sent` / `paid` / `cancelled`
- Date sent
- Link to invoice detail

**Send New Invoice button** → `/admin/invoices/new?session=[id]`

---

### Section 4 — Tools

**Grading tool link** — instructor (own session) + super admin only:
- `"Open Grading Tool"` → `/admin/sessions/[id]/grades`
- Disabled if session status is not `completed`
- Shows progress: `"X of Y students graded"`

**Enrollware link** — instructor (own session) + super admin only:
- `"Open Enrollware"` — opens `https://www.enrollware.com` in a new tab
- Shows `enrollware_submitted` status badge

**CSV Export** — super admin only, completed sessions only:
- `"Export Student Data"` button
- Downloads CSV with: first name, last name, email, phone, employer, grade, booking source
- Pulls from both `bookings` (with profile join) and `roster_records`
- Disabled if `status !== 'completed'`

---

## Edit Session Form

When editing, show a form pre-populated with current session data:
- Class type (dropdown)
- Instructor (dropdown — manager/super admin can change; instructor cannot change)
- Location (dropdown of saved locations)
- Date and time
- Max capacity
- Notes

On save — if session was approved, reset `approval_status = 'pending_approval'`.

---

## Cancel Session Confirmation

Inline confirmation (not a modal):
```
"Cancel This Session?"
"This class becomes an open opportunity for other instructors to claim. Booked
 students are only notified once a new instructor picks it up — not now."
Reason: [text input, min 10 chars]
[Keep Session]  [Confirm Cancellation]
```

On confirm — handled by `POST /api/sessions/[id]/cancel`:
- Set `status = 'cancelled'`, `instructor_id = NULL`, `cancelled_at`, `cancelled_by`, `cancellation_reason` (dedicated column — NOT `notes`)
- Email admins/managers (cancellation notice) + all active instructors (claim opportunity)
- Do NOT email booked students — they are only emailed when the class is claimed
- Never triggers refunds — always a separate, manual, super-admin-only action

---

## Responsive

- Mobile: Sections stack vertically
- Desktop: Header full width, then two-column layout: students left, tools/invoices right

---

## What NOT to Do

- Do not show invoices section to managers — instructor and super admin only
- Do not allow instructors to edit approved sessions
- Do not show CSV export to anyone below super admin
- Do not show CSV export for non-completed sessions
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] All session details render correctly
- [ ] Approval/rejection actions work and send emails
- [ ] Edit button gated correctly by role and approval status
- [ ] Editing approved session shows warning and resets approval status
- [ ] Cancel session requires confirmation and reason (min 10 chars); instructor blocked <48hrs with call-Daniel modal
- [ ] Open-opportunity banner lets any instructor claim a cancelled session with a location picker (409 on lost race)
- [ ] Students only emailed when a cancelled class is claimed — never at cancellation
- [ ] Students section shows combined bookings + roster records
- [ ] Assistant and add-ons can be changed without resetting approval status
- [ ] Photos button uploads/views/deletes per-student documents, gated to managers and the owning instructor
- [ ] Roster upload banner shown when unimported upload exists
- [ ] Invoices section visible to instructor (own) and super admin only
- [ ] Tools section shows correct items per role
- [ ] CSV export only for super admin on completed sessions
- [ ] Enrollware link opens in new tab
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
