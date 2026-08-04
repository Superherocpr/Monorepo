# Superhero CPR — Schema Reference Notes

> Companion to schema.md
> Last updated: July 2026

---

## Table Relationships

```
profiles ||--o{ class_sessions              : "teaches"
profiles ||--o{ bookings                    : "makes"
profiles ||--o{ bookings                    : "created by (staff)"
profiles ||--o{ payments                    : "pays"
profiles ||--o{ payments                    : "logged by (staff)"
profiles ||--o{ certifications              : "holds"
profiles ||--o{ orders                      : "places"
profiles ||--o{ invoices                    : "sends"
profiles ||--o{ contact_replies             : "sends"
profiles ||--o{ stock_adjustments           : "adjusts"
profiles ||--o{ instructor_earnings         : "earns"
profiles ||--o{ instructor_payout_items     : "receives"
profiles ||--o{ instructor_payout_batches   : "creates"
profiles ||--o{ api_keys                    : "owns"
profiles ||--o{ class_requests              : "requests (customer)"
profiles ||--o{ class_sessions              : "cancelled by"
cert_types ||--o{ certifications            : "defines"
class_types ||--o{ class_sessions           : "defines"
class_types ||--o{ class_requests           : "requested as"
class_requests ||--o| class_sessions        : "fulfilled by"
locations ||--o{ class_sessions             : "hosts"
class_sessions ||--o{ bookings              : "has"
class_sessions ||--o{ roster_records        : "contains"
class_sessions ||--o{ certifications        : "produces"
class_sessions ||--o{ invoices              : "invoiced via"
class_sessions ||--o{ roster_uploads        : "has"
contact_submissions ||--o{ contact_replies  : "has"
bookings ||--o{ payments                    : "has"
bookings ||--o| roster_records              : "linked to"
invoices ||--o{ bookings                    : "creates"
invoices ||--o{ invoice_activity_log        : "logged in"
invoices ||--o| instructor_earnings         : "generates"
invoices ||--o{ roster_uploads              : "linked to"
payments ||--o| instructor_earnings         : "generates"
instructor_payout_batches ||--o{ instructor_payout_items : "contains"
instructor_payout_batches ||--o{ instructor_earnings     : "reserves"
instructor_payout_items ||--o{ instructor_earnings       : "pays"
products ||--o{ product_variants            : "has"
product_variants ||--o{ order_items         : "included in"
product_variants ||--o{ stock_adjustments   : "tracked in"
orders ||--o{ order_items                   : "contains"
```

---

## Complete Page List

### Public pages
| Route | Description | Auth |
|---|---|---|
| / | Home | Public |
| /about | About | Public |
| /classes | Class types | Public |
| /schedule | Live schedule | Public |
| /merch | Merchandise | Public |
| /contact | Contact form | Public |
| /book | Booking flow (multi-step) | Public → Auth |
| /rollcall | Walk-in student registration | Public |
| /roster/[session_token] | Student roster correction | Public |
| /submit-roster | Customer roster upload via invoice number | Public |

### Customer portal
| Route | Description | Auth |
|---|---|---|
| /dashboard | Customer dashboard | Customer |
| /dashboard/bookings | My bookings | Customer |
| /dashboard/certifications | My certifications | Customer |
| /dashboard/orders | My merch orders | Customer |
| /dashboard/settings | Account settings | Customer |
| /dashboard/request-class | Request a custom class at your location | Customer |
| /dashboard/class-requests | My class request history | Customer |

### Staff admin
| Route | Description | Who |
|---|---|---|
| /admin | Admin dashboard | All staff |
| /admin/sessions | Class sessions list | All staff |
| /admin/sessions/[id] | Session detail | All staff |
| /admin/sessions/[id]/grades | Grading tool | Instructor (own) + Super Admin |
| /admin/sessions/[id]/roster | Roster import | Manager + Super Admin |
| /admin/sessions/approvals | Approval queue | Manager + Super Admin |
| /admin/class-requests | Customer class requests | Manager + Super Admin |
| /admin/class-requests/[id] | Class request detail (approve/reject) | Manager + Super Admin |
| /admin/invoices | Invoice list | Instructor (own) + Manager + Super Admin |
| /admin/invoices/[id] | Invoice detail | Instructor (own) + Manager + Super Admin |
| /admin/invoices/new | Create invoice | Instructor + Super Admin |
| /admin/customers | Customer management | Manager + Super Admin |
| /admin/customers/[id] | Customer detail | Manager + Super Admin |
| /admin/payments | Payments | Manager + Super Admin |
| /admin/contact | Contact submissions | Manager + Super Admin |
| /admin/locations | Locations | Manager + Super Admin |
| /admin/certifications | Certifications | Super Admin |
| /admin/merch | Merch management | Super Admin |
| /admin/orders | Orders management | Super Admin |
| /admin/staff | Staff management | Super Admin |
| /admin/settings | Settings | Super Admin |
| /admin/archived | Archived accounts | Super Admin |
| /admin/analytics | Analytics | Super Admin |
| /admin/profile/payment | Instructor payment account | Instructor + Super Admin |

---

## Enrollware API

The Enrollware browser extension authenticates using the instructor's Supabase session credentials.

**Endpoints:**

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/enrollware/sessions | Instructor's unsubmitted sessions within 12hr window |
| GET | /api/enrollware/sessions/[id] | Full session details for class info form fill |
| GET | /api/enrollware/sessions/[id]/students | Graded roster records only (grade IS NOT NULL) |
| POST | /api/enrollware/sessions/[id]/submit | Marks enrollware_submitted = true |

**Session eligibility:**
- `instructor_id` matches authenticated instructor
- `starts_at` is within the last 12 hours
- `enrollware_submitted = false`
- `approval_status = approved`

---

## Invoice System

**Supported payment platforms:** PayPal, Square, Stripe, Venmo Business — all support OAuth and webhooks.

**Flow:**
1. Instructor selects approved class → chooses individual or group type
2. Enters recipient details, student count, price (auto or custom)
3. Invoice sent via Resend with payment link to instructor's connected platform
4. Payment confirmed via OAuth webhook or manually
5. On payment: booking records created for student_count spots
6. Multiple invoices to same recipient for same class allowed
7. Invoices never expire — closed by webhook, instructor marking paid, or cancelling
8. All invoice activity logged in invoice_activity_log
9. Group invoices include /submit-roster link with clear instructions

**Roster upload flow:**
1. Customer receives group invoice email with /submit-roster link and invoice number
2. Customer visits /submit-roster, enters invoice number, confirms class details
3. Customer uploads spreadsheet
4. Manager sees banner on session detail — "A customer roster has been uploaded"
5. Manager imports via roster import tool

---

## Class Approval Workflow

```
Instructor or Manager creates → approval_status: pending_approval
Manager or Super Admin approves → approval_status: approved
Manager or Super Admin rejects → approval_status: rejected + rejection_reason (min 10 chars)
Instructor edits + resubmits → approval_status: pending_approval
```

- All sessions require manual approval regardless of who creates them
- Self-approval allowed for managers and super admins
- Instructors cannot approve any session
- Approved sessions visible on public schedule and available for invoicing
- Editing an approved session resets it to pending_approval
- Instructors cannot edit approved sessions — must contact manager or super admin

---

## Class Cancellation & Open Opportunities

```
Cancel (POST /api/sessions/[id]/cancel)
  → status: cancelled, instructor_id: NULL
  → cancelled_at / cancelled_by / cancellation_reason set
  → emails: admins/managers + all active instructors (claim broadcast)
  → students NOT emailed

Claim (POST /api/sessions/[id]/claim — first come, first serve)
  → instructor_id: claimer, location_id: claimer's pick, status: scheduled
  → no re-approval required
  → emails: students (new instructor name/phone + new location) + admins/managers

Unclaimed within 48hrs of starts_at
  → pg_cron "notify-unclaimed-opportunities" → digest email to all super_admins
  → pure notification — a super admin decides manually (no auto-cancel)
```

**Who can cancel:**
- Instructor — own session only, and only >48hrs before `starts_at`. Inside 48hrs the UI shows a "call Daniel Hedgeman" modal (`OWNER_DIRECT_PHONE` in `lib/constants.ts`); the API enforces the same rule server-side.
- Manager / Super Admin — any session, any time (no 48hr restriction).

**Claiming:**
- Any active instructor/manager/super admin; no certification/specialty filtering.
- Atomic conditional UPDATE (`WHERE instructor_id IS NULL`) — a lost race returns 409.
- Claimer picks the location they'll teach from; existing bookings carry over untouched.
- Open sessions surface on the instructor dashboard "Open Opportunities" widget and via the broadcast email's link.

**Escalation cron:** fires at 12am/9am/12pm/3pm/6pm/9pm Eastern. pg_cron has no per-job timezone, so the job fires at the UTC-equivalents of those hours under BOTH EST and EDT (12 firings/day) and the route no-ops the 6 off-schedule firings by checking the real Eastern hour. `unclaimed_escalation_sent_at` prevents re-notifying the same session.

**Refunds are never automatic.** Cancellation/claiming never touches money. Refund or credit for a cancelled class is always a separate, manual, super-admin-only action through the existing invoice/order cancel-refund flows.

---

## Manual Booking Tracking

When a staff member manually adds a customer to a class:
- `booking_source = 'manual'`
- `created_by` = FK to the staff member's profile
- `manual_booking_reason` = required text

When a staff member cancels a booking:
- `cancelled = true`
- `cancellation_note` = required text
- `cancelled_by` = FK to the staff member's profile

---

## Staff Account States

**Customers** use `archived` / `archived_at` — soft-delete when a customer requests account deletion.
**Staff** use `deactivated` / `deactivated_at` — soft-disable when a staff member is removed from the team.

Both states prevent login and preserve all data. Neither physically deletes the Supabase auth user.

**Owner protection:** The business owner's email is hardcoded in `lib/constants.ts` as `OWNER_EMAIL`. That account's role can never be changed and it can never be deactivated by anyone.

---

## Zoho Mail Integration

Used exclusively for contact form replies at `/admin/contact`.
- OAuth credentials stored in `system_settings` table
- Sends and receives email via Zoho Mail API on behalf of `info@superherocpr.com`
- Inbound customer replies fetched from Zoho thread and displayed in admin
- Token auto-refreshes before expiry
- Does NOT handle any other emails — all other emails go through Resend

**Environment variables required:**
```
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REDIRECT_URI=https://superherocpr.com/api/contact/zoho-callback
```

---

## Cert Reminder System

Automated cert expiry reminders sent via Resend when a cert is within 90 days of expiry.

- Controlled by `system_settings.cert_reminders_paused`
- When `"true"`: automated reminders paused, manual bulk send blocked
- When `"false"` or not set: reminders active
- Only affects cert expiry emails — all other Resend emails unaffected
- Toggle at `/admin/certifications` — button labeled `"Pause Cert Reminders"` / `"Resume Cert Reminders"`

---

## Account Archival

- `profiles.archived = true` + `profiles.archived_at` on archival
- Customer signed out, cannot log back in
- All data preserved — bookings, certs, payments, orders
- Super admin can view and restore archived accounts

---

## Rollcall System

Students register for a class on the day via `/rollcall`.

**Flow:**
1. Student visits superherocpr.com/rollcall
2. Selects their instructor from a list
3. Sees today's approved classes for that instructor
4. Enters the instructor's daily 6-digit access code (announced verbally at class start)
5. Duplicate detection — if email already exists, prompted to sign in instead
6. New students enter info and choose a password — account created automatically
7. Welcome email sent via Resend
8. Booking record created with `booking_source = rollcall`
9. Student appears in instructor's grading tool

**Access code logic:**
- Each instructor has a `daily_access_code` on their profile
- Code auto-regenerates at midnight every day
- Super admin can manually regenerate
- Code displayed prominently on instructor's admin dashboard

---

## Roster Correction System

When a roster is imported for a session, students can correct their info via a unique URL.

**Flow:**
1. Manager imports roster → correction mode activates automatically
2. `session_token` generated, `correction_window_closes_at` = starts_at + 30 min
3. Students visit `/roster/[session_token]` on their phones
4. Student finds themselves, confirms or edits their info
5. `device_token` written to browser on first interaction — locks device to that record
6. Window closes automatically 30 minutes after class start
7. `confirmed` and `corrected` flags tracked per student

---

## Bio Markdown Files

Instructor bios stored as markdown files, rendered on /about page.

```
content/
  bios/
    lead-instructor.md        — Full bio for is_lead_instructor = true profile
    instructors/
      [bio_slug].md           — Short bio per instructor, keyed to profiles.bio_slug
```

If a bio file does not exist for an instructor, their card shows without bio text.

---

## Supabase RPC Functions

### `decrement_stock`
Atomically decrements stock quantity for a product variant. Used in merch order flow to prevent stock going below zero.

```sql
create or replace function decrement_stock(variant_id uuid, amount int)
returns void as $$
  update product_variants
  set stock_quantity = greatest(stock_quantity - amount, 0)
  where id = variant_id;
$$ language sql;
```

---

### `increment_stock`
Atomically increments stock quantity for a product variant. Used when a merch order is cancelled to restore stock.

```sql
create or replace function increment_stock(variant_id uuid, amount int)
returns void as $$
  update product_variants
  set stock_quantity = stock_quantity + amount
  where id = variant_id;
$$ language sql;
```

---

## Migration Naming Convention

Migration files live in `apps/migrations/`, numbered sequentially (`0001_...` through
the current head). **Always name a migration file identically in staging and
production** — apply the same filename to both environments, even if the change
was drafted or hotfixed on one side first.

This wasn't followed consistently for a stretch: as of 2026-08-04, staging and
production both sit at the same migration count and are schema-identical, but
several entries in `list_migrations` carry different names for the same change
(e.g. `class_assistants` on staging vs `0033_class_assistants` on production;
`add_discount_percent_to_class_sessions` vs `0028_discount_percent_catchup`).
Content matches, names don't — which means the two environments' migration
history can't be diffed mechanically, only eyeballed. Don't rename already-applied
migrations to fix the historical entries (that rewrites applied history on live
databases); just keep names in sync going forward.

---

## Admin Sidebar Navigation by Role

### Instructor
- Dashboard
- My Sessions
- Grading Tool
- Invoices
- Rollcall
- Profile
  - Payment Account

### Manager
- Dashboard
- Classes (all sessions + approvals queue)
- Customers
- Payments
- Contact Submissions
- Locations

### Super Admin
- Dashboard
- Classes + Approvals
- Customers
- Payments
- Contact Submissions
- Locations
- Certifications
- Merch
- Orders
- Staff Management
- Settings
- Archived Accounts
- Analytics
- View As Instructor (dropdown)

### Inspector
- Dashboard
- *(AED inspection and sales pages — TBD)*

---

## Emails — Resend

| Trigger | Recipient | Subject |
|---|---|---|
| Account created (booking or rollcall) | New customer | Welcome to Superhero CPR! |
| Staff invited | New staff member | You've been invited to join Superhero CPR |
| Manager creates customer account | Customer | Set up your Superhero CPR account |
| Payment confirmed (online) | Customer | Booking Confirmed — [class] on [date] |
| Invoice sent (individual) | Recipient | Invoice from Superhero CPR — [class] on [date] |
| Invoice sent (group) | Recipient | Invoice from Superhero CPR — [class] on [date] + roster link |
| Invoice paid | Instructor + Manager | Invoice Paid — [recipient] for [class] |
| Roster uploaded by customer | Manager | Roster submitted for [class] on [date] |
| Roster upload confirmed | Customer (if email provided) | Your roster for [class] has been received |
| Class session rejected | Instructor | Your class submission was not approved |
| Class session approved | Instructor | Your class has been approved |
| Contact form submitted | Business | New Contact Form Submission — [inquiry type] |
| Contact form submitted | Submitter | We received your message — Superhero CPR |
| Cert expiring soon | Customer | Your CPR Certification Expires Soon |
| Account archived | Customer | Your Superhero CPR account has been deleted |
| Merch order confirmed | Customer + Business | Your Superhero CPR Order is Confirmed |
| Merch order shipped | Customer | Your Superhero CPR order has shipped! |
| Class session cancelled | Admins/managers | Class cancelled — [class] on [date] |
| Class session cancelled | Active instructors | Open Class Opportunity — [class] on [date] (First Come, First Serve) |
| Cancelled session claimed | Enrolled students | Good news — your class has a new instructor |
| Cancelled session claimed | Admins/managers | [Instructor] claimed a cancelled class — [class] on [date] |
| Cancelled session unclaimed 48hrs before start | Super admins | Action needed — unclaimed class(es) starting soon |
