# Running a Class — Rollcall to Enrollware

A technical and plain-English walkthrough of what happens on the day of a class,
from the instructor displaying the rollcall code to submitting the roster in Enrollware.

---

## Overview

On class day, the instructor shows a 6-digit code on their phone or screen.
Students scan in at that code, check in with their password (or create an account
on the spot). After class the instructor grades students, then uses a browser
bookmark to push the roster into Enrollware — the AHA-affiliated certification
system — with one click.

---

## Phase 1 — Rollcall: students check in

### Step 1a — Instructor gets their daily code

**Widget:** `RollcallCodeWidget` on the admin dashboard  
**Code:** `POST /api/rollcall/refresh-my-code`

Each instructor has a `daily_access_code` field on their profile. It is a
6-digit number that regenerates automatically at midnight via a `pg_cron` job
(migration 0006). The instructor can also manually refresh it from their dashboard.

The code is **instructor-specific** — it unlocks only that instructor's sessions
for today. It is not a global PIN.

**Plain English:** The instructor has a 6-digit code that changes every day. They
show it to students at the start of class.

---

### Step 1b — Student opens the rollcall page and enters the code

**Page:** `/rollcall` (public, no login required to start)  
**Code:** `POST /api/rollcall/verify-code`

The student visits `superherocpr.com/rollcall`, types the code, and the page
auto-submits on the 6th digit. The API:

1. **Rate-limits by IP** — max 10 attempts per hour per IP address to block
   brute-force guessing of the 6-digit code space (THREAT-009)
2. Looks up the instructor whose `daily_access_code` matches
3. Returns that instructor's approved class sessions for today

If the code is wrong, the student gets an error. No session data is exposed
on an invalid code.

**Plain English:** The student enters the code and the app figures out which
instructor's class they're in. Nothing sensitive is revealed on a wrong guess.

---

### Step 1c — Student selects which session they are in

If the instructor is running multiple sessions today, the student picks which
one they are attending. The chosen `sessionId` is used for all subsequent steps.

---

### Step 1d — Student picks their name from the roster

**Code:** `POST /api/rollcall/session-students`

The page lists every enrolled (non-cancelled-booking) student for the session —
names only, no contact details. The student taps their own name. No email entry,
no password.

> Students who don't see their name are directed to contact the instructor —
> a booking must already exist (online, invoice, or manual admin creation)
> before check-in is possible (THREAT-007: unpaid walk-ups are rejected).

---

### Step 1e — Student reviews their contact info

**Code:** `POST /api/rollcall/student-profile`

The API returns the student's profile details (gated by an active-booking
check) so they can confirm the info their certification will be issued with.

---

### Step 1f — Student confirms (or corrects) and checks in

**Code:** `POST /api/rollcall/checkin-by-profile`

- **"This is correct — Check Me In"** → inserts a `roster_records` row with
  `confirmed = true`. No password needed — the 6-digit code plus an existing
  booking is the gate.
- **"Update My Info"** → the student edits their details and must enter their
  **password**; the API verifies it via `signInWithPassword` before applying
  the profile updates, then inserts the roster record with `confirmed = true`
  and `corrected = true`.
- Already checked in → confirms gracefully (idempotent — double-tap is safe).

**Plain English:** The student proves who they are by being in the room (the
code) and having paid (the booking). Changing personal data requires their
password so nobody else can edit it. `confirmed = true` is what the admin
session page's **Verified** column reads.

> **History:** an earlier email + password flow (`check-email`, `checkin`,
> `register` routes) was replaced by this profile-based flow; those routes
> were removed 2026-07-15 (the unauthenticated `check-email` endpoint was
> also an email-enumeration oracle — THREAT-046).

**Plain English:** A student who doesn't have an account yet can create one on
the spot. The app still requires that they were already registered for the class
before it lets them in.

---

### Step 1g — Instructor sees the live roster

**Code:** `GET /api/rollcall/session-students`

As students check in, the `roster_records` table fills up. The instructor can
see the live list on their admin dashboard or on the rollcall screen — each
student is shown with a green check once they have a `roster_records` row.

**Plain English:** The instructor watches names appear on their screen as
students check in.

---

## Phase 2 — During and after class: grading

After class the instructor goes to the **Roster** view for the session and
records each student's pass/fail grade. Grades are stored on `roster_records`
and feed into the Enrollware submission in Phase 3.

---

## Phase 3 — Enrollware submission

Enrollware is the AHA (American Heart Association) certification management
system. Every completed class must be submitted there so students receive
their official AHA CPR certification.

### Step 3a — Instructor generates their API key

**Page:** `/admin/profile/enrollware` (or similar settings page)  
**Code:** `POST /api/enrollware/generate-key`

The instructor generates a personal API key that is stored in the `api_keys`
table. This key is used to authenticate the bookmarklet to the SuperHeroCPR API
from the Enrollware domain.

---

### Step 3b — Instructor saves the bookmarklet

**Code:** `GET /api/enrollware/bookmarklet`

The instructor visits their Enrollware tool page in the admin dashboard, which
shows a "Save Bookmark" button. The bookmark URL is a tiny JavaScript snippet
that:

1. Stores the instructor's API key inside the bookmark itself
2. When clicked on Enrollware, fetches the full bookmarklet script from
   `/api/enrollware/bookmarklet` (so the script can be updated without
   the instructor re-saving their bookmark)
3. Runs the script on the current Enrollware page

**Plain English:** The instructor saves a special bookmark in their browser once.
From then on, clicking it on any Enrollware page activates the tool.

---

### Step 3c — On class day: instructor clicks the bookmarklet on Enrollware

**Code:** `GET /api/enrollware/today-classes`

When the instructor clicks the bookmark while on Enrollware's class-edit page,
the script:

1. Authenticates with the API key embedded in the bookmark
2. Fetches today's classes from the SuperHeroCPR API, including the full
   roster of checked-in students with names, emails, phone numbers, and grades
3. **Detects what kind of Enrollware page** the instructor is on:
   - **New class form** — shows a class picker overlay, fills all class fields
     (date, time, location, instructor name) automatically using Enrollware's
     form field names
   - **Existing class with student list** — generates a CSV from the roster
     and injects it into Enrollware's "Import Students" file input

The API uses the instructor's **local browser timezone** (passed as `?tz=`) to
determine "today" — preventing a UTC day-rollover bug where evening classes
could otherwise show up as tomorrow's.

Classes already marked `enrollware_submitted = true` are included but flagged
as already done.

**Plain English:** The instructor clicks one bookmark on the Enrollware website.
The tool automatically fills in the class details and generates a student
import file — no manual typing or copy-pasting required.

---

### Step 3d — Instructor confirms the import in Enrollware

The instructor clicks "Import Students" in Enrollware to process the pre-filled
file. Once they confirm, they return to the bookmarklet overlay and click
"Mark as Submitted."

---

### Step 3e — Mark submitted

**Code:** `POST /api/enrollware/mark-submitted`

Sets `class_sessions.enrollware_submitted = true` for the session. The API
verifies that the session belongs to the authenticated instructor — one instructor
cannot mark another instructor's class. Once submitted, the session is removed
from the bookmarklet's pending list.

**Plain English:** Clicking "Done" in the bookmarklet flags the class so the
instructor won't accidentally submit it to Enrollware a second time.

---

## Full class-day flow summary

```
Instructor shows 6-digit daily code
    ↓
Student visits /rollcall, enters code
    → API rate-limits by IP, verifies code
    → Returns instructor's sessions for today
    ↓
Student selects session, enters email
    → Existing account? → sign in → verify booking → check in
    → New account?      → register → check in
    ↓
roster_records row inserted per student
    ↓
Instructor grades students (pass/fail on roster)
    ↓
Instructor opens Enrollware, clicks bookmarklet
    → Bookmarklet fetches today's classes + roster from API
    → Fills class form OR injects student import CSV
    ↓
Instructor imports students in Enrollware
    ↓
Instructor clicks "Mark as Submitted"
    → class_sessions.enrollware_submitted = true
```

---

## Key files

| File | Role |
|---|---|
| `app/(admin)/_components/dashboard/RollcallCodeWidget.tsx` | Daily code display on instructor dashboard |
| `app/api/rollcall/verify-code/route.ts` | Validates 6-digit code, returns today's sessions |
| `app/api/rollcall/session-students/route.ts` | Returns enrolled student names for the roster picker |
| `app/api/rollcall/student-profile/route.ts` | Returns contact details for the info-review step |
| `app/api/rollcall/checkin-by-profile/route.ts` | Creates confirmed roster record; password-gated profile edits |
| `app/api/rollcall/refresh-my-code/route.ts` | Manually regenerates instructor's daily code |
| `app/api/enrollware/generate-key/route.ts` | Creates instructor API key for bookmarklet auth |
| `app/api/enrollware/bookmarklet/route.ts` | Serves the live bookmarklet JavaScript |
| `app/api/enrollware/today-classes/route.ts` | Returns today's sessions + rosters for bookmarklet |
| `app/api/enrollware/mark-submitted/route.ts` | Marks a session as submitted in Enrollware |
| `lib/enrollware-bookmarklet.ts` | Full bookmarklet JavaScript source |
| `lib/enrollware-api-auth.ts` | API key validation + CORS headers for Enrollware routes |
