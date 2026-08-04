# Superhero CPR — Seed Data Generation Prompt

## Purpose

Generate a comprehensive, realistic seed script for the Superhero CPR platform.
The data must tell a coherent story — a real CPR training business that has been
operating for approximately 18 months. Staff teach classes. Customers attend those
classes. Money changes hands. Certifications get issued. Invoices get sent to
companies. Everything connects to everything else the way it would in a real business.

**The data is NOT random.** It is authored. Build the people first. Then build what
they did. Then connect the outcomes to what happened.

---

## Output

A single TypeScript file at `apps/web/supabase/seed.ts`.
Run with: `npx ts-node --project tsconfig.json supabase/seed.ts`
Uses the Supabase service role client to bypass RLS.
Idempotent — define all records with fixed UUIDs as constants at the top of the file.
On each run: delete all seeded data in reverse dependency order, then re-insert.

Read `Building/schema.md` for exact table and column names before writing any insert.

---

## The Business Narrative

Superhero CPR is a growing AHA-certified CPR training business in Tampa, Florida.
Danny Hernandez founded it and is the lead instructor. Over the past 18 months the
business has grown from Danny teaching solo to a team of 14 instructors. They train
healthcare workers, corporate employees, and the general public. Some clients are
individuals who book online. Others are companies that receive invoices and send
groups of employees.

The seed data represents this business at a realistic point in its operation —
not brand new (empty) and not massive (overwhelming). A functioning, busy, small
training business with real history and real forward bookings.

---

## Step 1 — Build the Staff (20 people)

Build staff first. Every session, invoice, and grading record connects back to a
staff member. Staff have histories and personalities that should be reflected in
the data that follows.

### The Owner — Super Admin (1)

**Danny Hernandez** — danny@superherocpr.com — TestPass123!
- Role: super_admin
- `is_lead_instructor`: true
- `bio_slug`: "danny-hernandez"
- `paypal_payout_email`: danny@superherocpr.com
- `daily_access_code`: "123456"
- Phone, full Tampa address filled in
- Danny teaches the most sessions — roughly 40% of all classes
- He is the go-to for BLS and corporate groups

### Managers (3)

**Lisa Chen** — lisa@superherocpr.com — TestPass123!
- Role: manager
- Full address filled in
- Lisa handles most of the admin work — contact replies, customer notes

**Marcus Webb** — marcus@superherocpr.com — TestPass123!
- Role: manager
- Full address filled in

**Patricia Gomez** — patricia@superherocpr.com — TestPass123!
- Role: manager
- Full address filled in

### Inspectors (2)

**Tom Bradley** — tom@superherocpr.com — TestPass123!
- Role: inspector

**Angela Ross** — angela@superherocpr.com — TestPass123!
- Role: inspector

### Instructors (14)

Give each instructor a realistic identity. Most instructors should have a
`paypal_payout_email` so payout batching can be tested; leave one or two blank
to exercise the missing-payout-email gate.

1. **Sarah Martinez** — sarah@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: sarah@superherocpr.com
   `daily_access_code`: "654321"
   Specialty: Pediatric CPR, Heartsaver — teaches about 15% of all sessions
   Full address filled in

2. **Kevin Okafor** — kevin@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: kevin@superherocpr.com
   `daily_access_code`: "234567"
   Specialty: BLS — teaches mostly healthcare worker groups

3. **Brittany Hall** — brittany@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: brittany@superherocpr.com
   `daily_access_code`: "345678"
  Note: Online bookings are collected by the SuperHeroCPR business PayPal account

4. **Darnell Washington** — darnell@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: blank
   `daily_access_code`: "456789"
  Note: Missing payout email blocks invoice creation and payout eligibility

5. **Mei-Ling Torres** — meiling@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: meiling@superherocpr.com
   `daily_access_code`: "567890"

6. **Jordan Price** — jordan@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: jordan@superherocpr.com
   `daily_access_code`: "678901"

7. **Tasha Nguyen** — tasha@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: tasha@superherocpr.com
   `daily_access_code`: "789012"

8. **Brandon Ellis** — brandon@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: brandon@superherocpr.com
   `daily_access_code`: "890123"

9. **Cynthia Park** — cynthia@superherocpr.com — TestPass123!
  Role: instructor | `paypal_payout_email`: cynthia@superherocpr.com
   `daily_access_code`: "901234"

10. **Derek Simmons** — derek@superherocpr.com — TestPass123!
    Role: instructor | `paypal_payout_email`: derek@superherocpr.com
    `daily_access_code`: "012345"

11. **Renee Foster** — renee@superherocpr.com — TestPass123!
    Role: instructor | `paypal_payout_email`: renee@superherocpr.com
    `daily_access_code`: "135790"

12. **Omar Castillo** — omar@superherocpr.com — TestPass123!
    Role: instructor | `paypal_payout_email`: omar@superherocpr.com
    `daily_access_code`: "246801"

13. **Vanessa Burke** — vanessa@superherocpr.com — TestPass123!
    Role: instructor | `paypal_payout_email`: vanessa@superherocpr.com
    `daily_access_code`: "357912"
    Note: Standard payout-ready instructor.

14. **James Ford** — james.ford@superherocpr.com — TestPass123!
    Role: instructor | `paypal_payout_email`: james.ford@superherocpr.com
    `deactivated`: true | `deactivated_at`: 45 days ago
    Note: Deactivated instructor. His past sessions, invoices, and grades are
    preserved. He appears in the staff list with a deactivated badge. Login fails.

---

## Step 2 — Build the Locations (5)

These are real venue types in Tampa. Sessions are distributed across them.

1. **Home Base** — 4321 N Himes Ave, Tampa, FL 33614
   `is_home_base`: true
   Notes: "Free parking in the lot. Enter through the main lobby."
   Most sessions happen here.

2. **Tampa General Hospital** — 1 Tampa General Circle, Tampa, FL 33606
   Notes: "Visitor parking available. Check in at main security desk. Ask for CPR Training."
   Used for BLS classes for healthcare workers.

3. **Hillsborough County Fire Station 1** — 808 E Zack St, Tampa, FL 33602
   Notes: "Ring the bell at the side door. Ask for the training coordinator."

4. **St. Joseph's Hospital** — 3001 W Dr Martin Luther King Jr Blvd, Tampa, FL 33607
   Notes: "Training room is on the 2nd floor, Room 214. Bring your employee badge."

5. **Raymond James Stadium** — 4201 N Dale Mabry Hwy, Tampa, FL 33607
   Notes: "Corporate training entrance is Gate C. Parking validated. Contact events coordinator on arrival."

---

## Step 3 — Build the Class Types and Cert Types

### Class Types (5 — 4 active, 1 inactive)
- BLS (Basic Life Support) — 180 min — max 8 — $65.00 — active
- Heartsaver CPR/AED — 150 min — max 8 — $55.00 — active
- CPR + AED — 120 min — max 6 — $50.00 — active
- Pediatric CPR — 120 min — max 6 — $55.00 — active
- First Aid (standalone) — 90 min — max 10 — $45.00 — **inactive**
  Tests the inactive class type state in settings and confirms it is hidden from
  the public booking and invoice creation flows.

### Cert Types (4)
- BLS — 24 months validity — American Heart Association
- Heartsaver CPR/AED — 24 months validity — American Heart Association
- CPR + AED — 24 months validity — American Heart Association
- Pediatric CPR — 24 months validity — American Heart Association

### Preset Grades (6)
100 (Pass — Perfect), 85 (Pass), 80 (Pass), 75 (Pass), 70 (Pass — Minimum), 0 (Fail)

---

## Step 4 — Build the 100 Customers

Customers are real people with lives. Some are healthcare workers who need BLS.
Some are parents who took Pediatric CPR. Some are corporate employees sent by
their employer. Some are just community members. Build them with this variety.

### Customer Archetypes — distribute across 100 people

**Healthcare Workers (25 customers)**
Nurses, paramedics, medical assistants who need BLS certification for their jobs.
They tend to book BLS classes. Many have multiple certs over time because they
renew every 2 years. Several will have certs expiring soon. Some were booked via
corporate invoice (hospital sent a group).
- Full profiles: name, email, phone, address in Tampa Bay area
- Most have 1–3 past bookings
- Most have active BLS certs
- A few have expiring certs (within 90 days)
- `customer_notes` on several: "Hospital employee — verify with HR before archiving"

**Corporate Employees (20 customers)**
Office workers, retail staff, restaurant employees who were required to get certified
by their employer. Booked via group invoice. They may have had a company pay for it.
- These customers often have `booking_source = 'invoice'`
- Some are linked to the same invoice (same company, same session)
- Several attended in groups of 3–6 from the same company

**Parents and Caregivers (15 customers)**
Parents who took Pediatric CPR after having a baby or out of general concern.
Generally book online themselves. Tend to take Pediatric CPR or CPR+AED.
- Booked online (`booking_source = 'online'`)
- Many have a single cert (Pediatric CPR)
- Some came back for a second course

**General Public (25 customers)**
Individuals who wanted certification for personal reasons — interested in safety,
required for a volunteer role, or curious after watching a documentary.
- Variety of class types
- Mix of booking sources
- Some have only one booking ever, some have two or three

**Walk-In Students (5 customers)**
Students who showed up day-of to a class. Created an account during rollcall.
- `booking_source = 'rollcall'` for their booking
- May not have filled in full profile details (some fields nullable)
- Has a cert from the session they walked into

**Customers With Problems (5 customers)**
- 2 with cancelled bookings (they cancelled, or staff cancelled for them)
- 1 who booked and didn't show up (has booking, no cert issued)
- 1 with a pending payment that never completed
- 1 who had a refund/cancelled order

**Archived Customers (5 customers)**
Customers who have been soft-deleted. They have historical data (past bookings,
old payments, possibly old certs) but are no longer active.
- `archived = true`, `archived_at` between 3–12 months ago
- Their historical data is preserved and visible in admin
- They do not appear in the active customer list
- Login should fail for these accounts

---

## Step 5 — Build the 40 Sessions

This is the core of the seed data. Sessions must be distributed across instructors
and locations in a way that reflects a real schedule. Not all instructors teach
the same number of sessions. Danny teaches the most. Some instructors are newer
and have only a few sessions.

### Session Distribution Rules
- Danny teaches ~10 sessions (25%)
- Sarah teaches ~6 sessions (15%)
- Kevin teaches ~5 sessions (12%)
- Remaining 14 instructors share the other 19 sessions
- James Ford (deactivated) should have 2 completed past sessions — his history
  is preserved even though he's deactivated
- No instructor teaches more than 2 sessions in the same week
- Sessions are spread across all 5 locations with Home Base being most common (~60%)

### Session Timeline — spread across 18 months

**Completed Sessions (25 sessions) — past 12 months**
These are sessions that already happened. They have:
- `status = 'completed'`
- `roster_imported = true` on most (some older ones may not have used the system yet)
- `enrollware_submitted = true` on most
- Real bookings attached (customers who attended)
- Grades entered for all students
- Certifications issued to all who passed
- Some sessions are full (max capacity), some had 2–3 empty spots

Distribute class types realistically:
- BLS is most common (~40% of completed sessions) — healthcare workers need this most
- Heartsaver is second (~25%)
- CPR + AED (~20%)
- Pediatric CPR (~15%)

Build these 25 completed sessions first. Everything — bookings, payments, certs,
grades — flows from them.

Spread them realistically across the past 12 months:
- Months 12–10 ago: 5 sessions (business was smaller)
- Months 9–7 ago: 6 sessions
- Months 6–4 ago: 7 sessions
- Months 3–1 ago: 7 sessions (business is growing)

**Upcoming Approved Sessions (9 sessions) — next 45 days**
These are scheduled and approved — they show on the public schedule.
Each should have a realistic number of bookings already (not all empty, not all full).

- Session 1: BLS at Home Base — Danny — 4 days from now — 5/8 booked
- Session 2: Heartsaver at Tampa General — Kevin — 7 days from now — 3/8 booked
- Session 3: Pediatric CPR at Home Base — Sarah — 10 days from now — 4/6 booked
- Session 4: CPR+AED at St. Joseph's — Mei-Ling — 14 days from now — 2/6 booked
- Session 5: BLS at Hillsborough Fire Station — Danny — 18 days from now — 1/8 booked
- Session 6: Heartsaver at Raymond James — Brandon — 21 days from now — 6/8 booked
  (this one has a group invoice for a company taking 6 of those spots)
- Session 7: Pediatric CPR at Home Base — Tasha — 28 days from now — 0/6 booked
  (fully empty — tests "no bookings yet" state)
- Session 8: BLS at Tampa General — Sarah — 33 days from now — 8/8 booked
  (FULL — tests class full state on public schedule)
- Session 9: CPR+AED at Home Base — Renee — 40 days from now — 1/6 booked

**Pending Approval Sessions (4 sessions)**
These are in the approval queue. They do NOT appear on the public schedule.

- BLS at Home Base — Brittany — 25 days from now — pending_approval
- Heartsaver at St. Joseph's — Jordan — 30 days from now — pending_approval
- CPR+AED at Raymond James — Omar — 35 days from now — pending_approval
- Pediatric CPR at Home Base — Cynthia — 22 days from now — pending_approval

**Rejected Session (1 session)**
- Heartsaver at Raymond James — Darnell — 50 days from now — rejected
- `rejection_reason`: "This location requires a venue confirmation form submitted
  at least 30 days in advance. Please resubmit once you have received written
  confirmation from the Raymond James events team."

**In-Progress Session (1 session)**
- BLS at Home Base — Danny — started 1 hour ago, ends 2 hours from now
- `status = 'in_progress'`, `roster_imported = true`
- 4 students checked in, roster records exist, no grades yet

---

## Step 6 — Fill the Completed Sessions With Customers

For each of the 25 completed sessions, create bookings that connect real customers
to real sessions. This is where the data becomes a story.

### Rules for filling sessions
- Each completed session should have between 3 and its max capacity of bookings
- Distribute customers across sessions so each customer has a realistic history:
  - Healthcare worker customers appear in BLS sessions, mostly at Tampa General
    or Home Base
  - Corporate customers appear together in the same session (same company)
  - Parent/caregiver customers appear in Pediatric CPR sessions
  - Walk-in customers have exactly one booking each with `booking_source = 'rollcall'`
- Vary `booking_source` across the dataset:
  - ~60% 'online' (paid through the website)
  - ~20% 'invoice' (corporate bookings)
  - ~10% 'rollcall' (walk-ins)
  - ~10% 'manual' (staff added them manually, with a reason)
- A few customers should appear in multiple sessions over the 18 months —
  they renewed their certification or took a different class type
- The 5 cancelled bookings should be spread across different sessions
  with realistic cancellation notes

### Corporate Group Pattern
For the group invoice sessions, assign 4–6 corporate employee customers to the
same session. These customers all have `booking_source = 'invoice'` and their
bookings are all linked to the same invoice record. This represents a company
sending a group of employees.

Create at least 3 distinct "corporate client" scenarios:
1. Hillsborough County EMS sending 5 paramedics to a BLS session
2. A hospital sending 4 nurses to a BLS session at Tampa General
3. A corporate office sending 6 employees to a Heartsaver session at Raymond James

---

## Step 7 — Build the Roster Records and Grades

For every completed session with `roster_imported = true`, create roster records.

### Rules for roster records
- Every customer who has a booking in a completed, roster-imported session
  gets a roster_record
- `booking_id` is set on each record (linking roster to booking)
- `confirmed = true` on most records (students confirmed their info)
- `corrected = true` on about 20% (student made a change to their name/employer)
- Grades for all: use a realistic distribution:
  - ~80% score 85 or above (pass)
  - ~15% score 70–80 (minimum pass)
  - ~5% score 0 (fail) — 1–2 per session maximum
- The in-progress session has roster records but `grade = null` on all of them

### Walk-in Student Records
Walk-in customers have a `roster_record` created by the rollcall flow.
Their record has `device_token` set and `confirmed = true`.

### The Roster Upload Record
For the Raymond James group invoice session (upcoming, 21 days from now),
create a `roster_upload` record showing the company submitted their roster:
- `submitted_by_name`: "Events Coordinator"
- `submitted_by_email`: "events@raymondjames.com"
- `imported`: false — it's awaiting import by a manager
- `file_url`: placeholder S3 URL
- `original_filename`: "raymond-james-cpr-roster.xlsx"

---

## Step 8 — Issue the Certifications

For every student who passed (grade > 0) in a completed session, create a
certification record. This is the real output of the business.

### Rules for certifications
- `cert_type_id` matches the class type of the session they attended
  (BLS session → BLS cert, Heartsaver session → Heartsaver CPR/AED cert, etc.)
- `issued_at` = the date of the session (`starts_at` date)
- `expires_at` = issued_at + 24 months
- `session_id` is set (linking cert to the session it came from)
- `customer_id` is set

### Certification States to Test
Across the 100 customers, ensure the following cert states exist:

**Active and healthy (~60 customers)**
Certs issued in the last 12 months, expiring 12+ months from now.
`reminder_sent = false`

**Expiring soon (~8 customers)**
Certs expiring within the next 90 days (issued ~21+ months ago).
`reminder_sent = true` on some (reminder was already sent),
`reminder_sent = false` on others (reminder not yet sent — triggers the alert).

**Expired (~10 customers)**
Certs from older sessions that have passed their 24-month validity.
Some of these customers have since renewed (they have both an expired cert
and a newer active cert). Some have not renewed yet.
`reminder_sent = true` on all expired certs.

**Never certified (~15 customers)**
Customers who booked but either failed, never attended, or are new with only
upcoming bookings. No cert records.

**Archived customers' certs**
The 5 archived customers have old expired certs that are preserved in the database
even though the account is archived.

**Manually issued cert (1)**
One customer has a cert where `session_id = null` and `notes` explains it was
issued manually after verification of an external course completion.

---

## Step 9 — Build the 200 Payments

Payments flow from bookings. Every completed online booking needs a payment.
Every paid invoice needs a payment. Some cash/check payments exist too.

### Distribution of 200 payments

**Online payments (~130 payments)**
For every completed online booking (`booking_source = 'online'`):
- `payment_type = 'online'`
- `status = 'completed'`
- `paypal_transaction_id`: plausible fake ID (e.g. "TXN_ONLINE_001" through "TXN_ONLINE_130")
- `amount` matches the class type price at the time of booking
- `routing_note` varies based on the instructor's payment setup:
  - For Danny, Sarah, Kevin, Mei-Ling, Brandon, Derek, Renee, Omar (have active PayPal):
    `'Routed to instructor PayPal — [Instructor Name]'`
  - For Brittany (Square only), Jordan (Stripe only), Cynthia (Venmo only), Vanessa
    (PayPal inactive):
    `'Routed to business PayPal — instructor has no connected PayPal account'`
  - For Darnell (routing set to business):
    `'Routed to business PayPal — instructor payment routing set to business'`

**Invoice payments (~40 payments)**
For every paid invoice:
- `payment_type = 'invoice'`
- `status = 'completed'`
- `amount` matches the invoice total
- `booking_id = null` (invoice payments are not per-booking)

**Cash payments (~15 payments)**
Manual payments logged by staff for walk-in students or day-of cash payers:
- `payment_type = 'cash'`
- `status = 'completed'`
- `logged_by`: the instructor or manager who logged it
- `notes`: realistic notes ("Paid at door", "Cash received before class")

**Check payments (~8 payments)**
Corporate clients who paid by check:
- `payment_type = 'check'`
- `status = 'completed'`
- `notes`: "Check #1042 received from Hillsborough County EMS"

**Pending payments (~5 payments)**
Payments that started but didn't complete — testing the pending state:
- `payment_type = 'online'`
- `status = 'pending'`
- Linked to bookings that are upcoming (the customer is booked but hasn't fully paid)

**Failed payment (2 payments)**
- `payment_type = 'online'`
- `status = 'failed'`
- Tests the failed payment display in admin payments

---

## Step 10 — Build the Invoices

Invoices are sent by instructors to companies or individuals. Every invoice
connects to a session, an instructor, and eventually to bookings.

### Create ~15 invoices across different states

**Paid invoices (~7)**
Represent companies that received invoices and paid them. These are the corporate
group bookings from Step 6.

Example entries:
- Danny → Hillsborough County EMS → BLS session (completed) → 5 students → $325
  Platform: PayPal | status: paid | paid_at: session date + 3 days
  Activity log: created → sent → marked_paid (or webhook confirmed)

- Kevin → Tampa General Hospital → BLS session (completed) → 4 students → $260
  Platform: PayPal | status: paid
  Activity log: created → sent → marked_paid

- Sarah → St. Pete Children's Hospital → Pediatric CPR → 3 students → $165
  Platform: PayPal | status: paid

- Brandon → Raymond James Stadium → Heartsaver → 6 students → $330
  Platform: PayPal | status: paid | This is the one that also has a roster_upload

- Brittany → Local Restaurant Group → CPR+AED → 4 students → $200
  Platform: Square | status: paid
  (Brittany uses Square — tests Square invoice display)

- Jordan → Fitness Center → Heartsaver → 3 students → $165
  Platform: Stripe | status: paid
  (Jordan uses Stripe — tests Stripe invoice display)

- Darnell → Manufacturing Company → BLS → 6 students → $390
  Platform: PayPal (business account since routing = business) | status: paid

**Sent but unpaid invoices (~4)**
Outstanding invoices that have been sent but not yet paid:

- Danny → Tampa Bay Brewing Company → Heartsaver → 8 students → $440
  Platform: PayPal | status: sent
  This is the large corporate invoice visible on the admin dashboard as outstanding

- Mei-Ling → Dental Office → CPR+AED → 2 students → $100
  Platform: PayPal | status: sent

- Omar → School District → BLS → 4 students → $260
  Platform: PayPal | status: sent

- Brandon → Raymond James Stadium → Heartsaver → 6 students → $330 (upcoming session)
  Platform: PayPal | status: sent
  This is the active invoice for the upcoming session 21 days from now
  Students are linked as invoice bookings

**Cancelled invoices (~2)**
Invoices that were cancelled before payment:
- Renee → Event company → Heartsaver → 4 students → $220
  Platform: PayPal | status: cancelled | cancelled_at: 30 days ago
  Activity log: created → sent → cancelled
  cancellation reason in activity log: "Client cancelled event"

- Cynthia → Local business → CPR+AED → 3 students → $150
  Platform: Venmo Business | status: cancelled
  (Cynthia uses Venmo Business — tests Venmo badge display)

### Invoice Activity Logs
Every invoice must have a realistic `invoice_activity_log` history.
At minimum: created action. Paid invoices also have: sent, marked_paid or webhook.
Cancelled invoices have: sent, cancelled.

---

## Step 11 — Build the Merch Store

### Products (5 — 4 active, 1 inactive)

1. **Superhero CPR T-Shirt** — $25.00 — active — `low_stock_threshold`: 5
   Variants: XS (5), S (12), M (18), L (14), XL (9), XXL (3)

2. **CPR Keychain** — $8.00 — active — `low_stock_threshold`: 10
   Variants: One Size (47)

3. **Superhero CPR Hoodie** — $45.00 — active — `low_stock_threshold`: 3
   Variants: S (2), M (5), L (3), XL (1), XXL (0)
   Note: XXL is out of stock — tests out-of-stock size pill on merch page

4. **AHA Skills Guide Booklet** — $12.00 — active — `low_stock_threshold`: 10
   Variants: One Size (7)
   Note: 7 is below the low_stock_threshold of 10 — triggers low stock alert
   on admin dashboard

5. **CPR Mask** — $15.00 — **inactive** — does not appear on public merch page

### Stock Adjustments (3 records — audit trail)
- Hoodie XL: previous 3 → new 1 (adjusted by Danny, note: "Sold 2 at fire station event")
- T-Shirt M: previous 10 → new 18 (adjusted by Lisa, note: "New shipment received — 8 units")
- Keychain One Size: previous 60 → new 47 (adjusted by Danny, note: "Class day sales")

### Orders (~12 orders across all statuses)

Build orders for real customers. Orders should reflect what CPR instructors'
students would actually buy — branded gear after a class.

**Paid orders (~4)**
- Healthcare worker customer: T-Shirt (M) + Keychain — $33.00
- Corporate employee customer: Keychain × 3 — $24.00
- Parent/caregiver customer: Hoodie (S) — $45.00
- General public customer: T-Shirt (L) + AHA Guide — $37.00

**Shipped orders (~3)**
Orders that have been marked shipped with a tracking number:
- Customer 1: T-Shirt (XL) — $25.00 — tracking: "1Z999AA10123456784"
- Customer 2: Hoodie (M) — $45.00 — tracking: "9400111899223397623910"
- Customer 3: AHA Guide × 2 — $24.00 — tracking: "7489044813947450715690"

**Delivered orders (~2)**
Orders marked as fully delivered:
- Customer 1: Keychain × 2 — $16.00
- Customer 2: T-Shirt (S) + Keychain — $33.00

**Pending order (~1)**
- Customer: Hoodie (L) — $45.00
- Payment not yet confirmed

**Cancelled order (~2)**
- Customer 1: CPR Mask × 1 — cancelled before ship, note: "Customer changed mind"
- Customer 2: T-Shirt (XXL) — cancelled, note: "Out of stock — customer requested refund"

---

## Step 12 — Contact Submissions

Build a realistic inbox for the admin contact page.

### Unreplied Submissions (~5)
Messages that have come in and not yet been responded to:

1. "Tampa Bay Brewing Company" — Corporate Training inquiry
   "We have about 30 employees across two locations who need basic CPR certification.
   Do you offer discounts for large groups and can you come to our breweries?"

2. "Jennifer Walsh" — General Question
   "I'm a nursing student and need BLS certification before my clinical rotations
   start in 6 weeks. Do you have any upcoming BLS classes with spots available?"

3. "St. Pete Fire Rescue" — Group Booking
   "We're looking to schedule quarterly CPR refresher training for 8–12 staff.
   What are your rates and how far in advance do we need to book?"

4. "Carlos Mendez" — General Question
   "My company is requiring all managers to have first aid certification. Do you
   offer any classes specifically for non-medical professionals?"

5. "Suncoast Hospice" — Corporate Training
   "We need to arrange BLS certification for 15 of our nurses by end of quarter.
   Can you accommodate a group this large and what is your pricing?"

### Replied Submissions (~3)
Messages that Lisa or Danny has already responded to:

1. "Baycare Health System" — replied by Lisa (manager)
   Original: asked about group BLS pricing
   Reply: directed them to contact for a custom quote, provided Danny's direct line

2. "Michael Torres" — replied by Danny
   Original: asked if walk-ins are welcome to class
   Reply: explained the rollcall system and how to check in on the day

3. "Pinellas County Schools" — replied by Lisa
   Original: asked about Pediatric CPR for school nurses
   Reply: provided schedule link and group invoice information

---

## Step 13 — Social Feed Cache (6 records)

Simulate the Facebook photo feed on the home page.

Create 6 cached posts spread across the last 60 days:
1. A BLS class at Tampa General with a caption about healthcare workers
2. A Pediatric CPR class at Home Base — caption about parents learning to protect kids
3. A large group corporate session at Raymond James Stadium
4. A fire station session with firefighters
5. A morning BLS class with a motivational caption
6. A post about the business milestone (500th student certified)

Use plausible placeholder image URLs (Unsplash or picsum.photos URLs work).
`cached_at` should be within the last 24 hours for all records.

---

## Step 14 — System Settings

Insert initial system_settings rows:
- `cert_reminders_paused`: 'false'
- Zoho token keys: set to empty strings (tokens are set via OAuth flow in admin,
  not via seed data — but the keys should exist so settings page renders correctly)

---

## Implementation Instructions

### 1. Build in strict dependency order
```
preset_grades
class_types
cert_types
locations
↓
auth users (supabase.auth.admin.createUser)
profiles
↓
class_sessions
↓
bookings (online first, then rollcall, invoice, manual)
roster_records
payments
↓
invoices
invoice_activity_log
certifications
↓
products
product_variants
orders
order_items
stock_adjustments
↓
contact_submissions
contact_replies
roster_uploads
social_feed_cache
system_settings
```

### 2. Use fixed UUIDs
Define every UUID as a named constant at the top of the file:
```typescript
const IDS = {
  // Staff
  DANNY: '00000000-0000-0000-0000-000000000001',
  SARAH: '00000000-0000-0000-0000-000000000002',
  // ... etc

  // Sessions
  SESSION_BLS_DANNY_30_DAYS_AGO: '00000000-0000-0000-0000-000001000001',
  // ... etc
}
```
This makes the script idempotent and makes foreign key references readable.

### 3. Timestamps must tell the story
Do not use `now()` for all timestamps. Past sessions happened in the past.
Payments happened within 24 hours of their booking. Certs were issued on the
day of the session. Archived accounts were archived months ago. Use actual
computed dates: `new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)` for
"30 days ago", etc.

### 4. Payout data
Set `paypal_payout_email` on payout-ready instructors. Leave at least one active
instructor without a payout email so the invoice gate and blocked payout dashboard
state can be tested.

### 5. The data should pass a sanity check
After inserting, a developer should be able to:
- Log in as Danny and see a populated admin dashboard with real numbers
- See sessions with actual bookings on the schedule page
- Open a customer and see their real booking and cert history
- See invoices with activity logs
- See payments with routing notes
- Open the grading tool and see real students with grades
- See the merch store with products and stock levels
- See analytics with real data spanning 18 months

If any of those checks would show a blank screen, the seed data is incomplete.

---

## Login Summary Comment Block

Include this at the top of the seed file:

```typescript
/*
=================================================================
SEEDED USER ACCOUNTS — ALL PASSWORDS: TestPass123!
=================================================================

SUPER ADMIN:
danny@superherocpr.com          Super Admin / Lead Instructor

MANAGERS:
lisa@superherocpr.com           Manager
marcus@superherocpr.com         Manager
patricia@superherocpr.com       Manager

INSPECTORS:
tom@superherocpr.com            Inspector
angela@superherocpr.com         Inspector

INSTRUCTORS (active):
sarah@superherocpr.com          Instructor — PayPal connected
kevin@superherocpr.com          Instructor — PayPal connected
brittany@superherocpr.com       Instructor — Square only (PayPal fallback)
darnell@superherocpr.com        Instructor — routing=business, no accounts
meiling@superherocpr.com        Instructor — PayPal connected
jordan@superherocpr.com         Instructor — Stripe only (PayPal fallback)
tasha@superherocpr.com          Instructor — PayPal connected
brandon@superherocpr.com        Instructor — PayPal connected
cynthia@superherocpr.com        Instructor — Venmo only (PayPal fallback)
derek@superherocpr.com          Instructor — PayPal connected
renee@superherocpr.com          Instructor — PayPal connected
omar@superherocpr.com           Instructor — PayPal connected
vanessa@superherocpr.com        Instructor — Square + PayPal inactive (fallback)

INSTRUCTORS (deactivated — login will fail):
james.ford@superherocpr.com     Instructor — Deactivated 45 days ago

CUSTOMERS — see seed file for full list of 100 customer accounts
=================================================================
*/
```
