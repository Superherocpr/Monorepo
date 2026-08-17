# Superhero CPR — Database Schema

> Stack: Supabase (PostgreSQL)
> Last updated: July 2026
> See schema-notes.md for relationships, page list, system notes, and email triggers.

---

## Legend

| Badge | Meaning |
|---|---|
| PK | Primary key |
| FK | Foreign key |
| NN | Not null |
| UQ | Unique |

---

## Users

### `profiles`
> All users — customers, instructors, managers, admins, inspectors. Extends Supabase `auth.users`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | References auth.users.id |
| first_name | text | NN | |
| last_name | text | NN | |
| email | text | NN, UQ | |
| phone | text | | |
| address | text | | Used for certification records |
| city | text | | |
| state | text | | |
| zip | text | | |
| role | enum | NN | `customer` `instructor` `manager` `super_admin` `inspector` — default: customer |
| is_lead_instructor | boolean | NN | Default: false. Only one profile ever true. |
| bio_slug | text | | Maps to content/bios/instructors/[bio_slug].md. Nullable. |
| bio_photo | text | | Public URL of the staff headshot shown on the About page. |
| bio_description | text | | Plain-text staff bio shown on the About page. |
| bio_credentials | text | | Comma-separated credentials shown under public staff bios. |
| bio_published | boolean | NN | Default: false. Controls whether the staff bio can appear publicly. |
| bio_years_experience | text | | Optional lead instructor stat display value. |
| bio_students_trained | text | | Optional lead instructor stat display value. |
| daily_access_code | text | | 6-digit rollcall code. Instructor profiles only. Auto-regenerates daily at midnight. |
| access_code_generated_at | timestamptz | | Used to determine when to regenerate the daily code. |
| archived | boolean | NN | Default: false. Soft-delete for customers. Cannot log in when true. Data preserved. |
| archived_at | timestamptz | | Set when customer account is archived. Null if not archived. |
| deactivated | boolean | NN | Default: false. Soft-disable for staff. Cannot log in when true. Data preserved. |
| deactivated_at | timestamptz | | Set when staff account is deactivated. Null if not deactivated. |
| customer_notes | text | | Internal staff notes. Never visible to the customer. |
| paypal_payout_email | text | | PayPal email where instructor payouts are sent. Nullable until staff saves it. |
| created_at | timestamptz | NN | Default: now() |
| updated_at | timestamptz | NN | Default: now() |

---

### `api_keys`
> API keys for external integrations. Reserved for future use.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| profile_id | uuid | FK, NN | → profiles.id |
| key_hash | text | NN | Hashed API key — never stored in plain text |
| label | text | NN | e.g. "External Integration" |
| last_used_at | timestamptz | | Updated on each use |
| created_at | timestamptz | NN | Default: now() |

---

### `system_settings`
> Key-value store for system-wide configuration.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| key | text | PK, NN | See schema-notes.md for known keys |
| value | text | NN | Setting value — encrypted for sensitive keys |
| updated_at | timestamptz | NN | Default: now() |

**Known keys:** `zoho_access_token` `zoho_refresh_token` `zoho_account_id` `zoho_token_expires_at` `cert_reminders_paused` `platform_fee_percent`

---

## Social

### `social_feed_cache`
> Cached Facebook photo posts. Refreshed by a background job every few hours.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| facebook_post_id | text | NN, UQ | Facebook's post ID. Prevents duplicate cache entries. |
| photo_url | text | NN | Direct URL to the photo |
| post_url | text | NN | Link to the original Facebook post |
| caption | text | | Post caption text, if available |
| posted_at | timestamptz | NN | When the post was published on Facebook |
| cached_at | timestamptz | NN | When this record was last refreshed. Default: now() |

---

## Contact

### `contact_submissions`
> Submissions from the /contact page contact form.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| name | text | NN | Submitter's full name |
| email | text | NN | Submitter's email |
| phone | text | | Optional |
| inquiry_type | text | NN | e.g. "General Question", "Group Booking", "Corporate Training" |
| message | text | NN | Full message body |
| replied | boolean | NN | Default: false. Set to true automatically when a reply is sent via Zoho. |
| created_at | timestamptz | NN | Default: now() |

---

### `contact_replies`
> Replies sent by staff to contact form submissions via Zoho Mail.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| submission_id | uuid | FK, NN | → contact_submissions.id |
| sent_by | uuid | FK, NN | → profiles.id |
| subject | text | NN | |
| body | text | NN | |
| zoho_message_id | text | | For thread linking |
| has_attachments | boolean | NN | Default: false |
| created_at | timestamptz | NN | Default: now() |

---

## Certifications

### `cert_types`
> Admin-managed certification types.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| name | text | NN, UQ | e.g. "BLS", "Heartsaver", "CPR+AED", "Pediatric CPR" |
| description | text | | |
| validity_months | int | NN | e.g. 24 |
| issuing_body | text | | e.g. "American Heart Association" |
| active | boolean | NN | Default: true |
| created_at | timestamptz | NN | Default: now() |

---

### `certifications`
> A customer's earned certifications. Multiple per customer supported.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| customer_id | uuid | FK, NN | → profiles.id |
| cert_type_id | uuid | FK, NN | → cert_types.id |
| session_id | uuid | FK | → class_sessions.id. Nullable — cert may be entered manually. |
| issued_at | date | NN | Date cert was earned |
| expires_at | date | NN | Computed: issued_at + cert_types.validity_months |
| cert_number | text | | Optional AHA cert number |
| reminder_sent | boolean | NN | Default: false. Tracks if expiry reminder was sent via Resend. |
| notes | text | | Admin notes if manually entered |
| created_at | timestamptz | NN | Default: now() |

---

## Classes

### `class_types`
> The available CPR course offerings. Can be deactivated to hide from public booking and invoicing.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| name | text | NN, UQ | BLS, Heartsaver, CPR+AED, Pediatric CPR |
| description | text | | Shown on the website booking page |
| duration_minutes | int | NN | |
| max_capacity | int | NN | Default capacity, overridable per session |
| price | numeric(10,2) | NN | |
| active | boolean | NN | Default: true. When false: hidden from public schedule, booking flow, and invoice creation. Existing sessions unaffected. |
| created_at | timestamptz | NN | Default: now() |

---

### `locations`
> Class venues — home base and one-off locations.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| name | text | NN | e.g. "Home Base", "Tampa General Hospital" |
| address | text | NN | |
| city | text | NN | |
| state | text | NN | |
| zip | text | NN | |
| notes | text | | Parking info, access instructions etc. |
| is_home_base | boolean | NN | Default: false. Only one location true at a time. |
| created_at | timestamptz | NN | Default: now() |

---

### `class_sessions`
> A scheduled instance of a class type. One session = one class on one date.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| class_type_id | uuid | FK, NN | → class_types.id |
| instructor_id | uuid | FK | → profiles.id. Nullable for customer-requested sessions until an instructor accepts, and for cancelled sessions until another instructor claims them. |
| location_id | uuid | FK, NN | → locations.id |
| starts_at | timestamptz | NN | |
| ends_at | timestamptz | NN | |
| max_capacity | int | NN | Overrides class_type default if needed |
| status | enum | NN | `scheduled` `in_progress` `completed` `cancelled` |
| approval_status | enum | NN | `pending_approval` `approved` `rejected` — default: pending_approval |
| rejection_reason | text | | Required when rejected. Min 10 chars. Shown to instructor. |
| google_calendar_event_id | text | | Set when imported from Google Calendar. TBD — not yet planned. |
| roster_imported | boolean | NN | Default: false. Triggers correction mode when true. |
| session_token | text | UQ | Generated when roster imported. Used in roster correction URL. |
| correction_window_closes_at | timestamptz | | Set to starts_at + 30 min when roster imported |
| enrollware_submitted | boolean | NN | Default: false. |
| notes | text | | Internal notes |
| discount_percent | numeric | | Promotional discount 0–50%. Null = no discount. |
| travel_fee | numeric | | Flat travel & setup fee. $65 for customer-requested sessions; NULL for staff-created. |
| class_request_id | uuid | FK | → class_requests.id. Set only for customer-requested sessions. |
| cancelled_at | timestamptz | | Set when status = 'cancelled'. |
| cancelled_by | uuid | FK | → profiles.id. Who cancelled the session. |
| cancellation_reason | text | | Free-text reason provided by the canceller. Min 10 chars, enforced at the API layer. |
| unclaimed_escalation_sent_at | timestamptz | | Set once the 48hr-unclaimed escalation email has fired for this session, so the cron doesn't re-notify. |
| is_private | boolean | NN | Default: false. True for team/corporate sessions — hidden from `/book`, `/schedule`, and the anon RLS read policy. Reachable only via its team link. |
| created_at | timestamptz | NN | Default: now() |

---

### `class_requests`
> A customer's request for a class at their location. Reviewed by managers/super admins.
> On approval a class_sessions row is created and instructors are notified first-come-first-serve.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| customer_id | uuid | FK, NN | → profiles.id |
| class_type_id | uuid | FK, NN | → class_types.id |
| preferred_date | date | NN | Must be ≥7 days from submission date |
| preferred_time_of_day | text | NN | `morning` `afternoon` `evening` `flexible` |
| group_size | int | NN | Min 1 |
| venue_name | text | NN | Customer-provided venue/facility name |
| venue_address | text | NN | |
| venue_city | text | NN | |
| venue_state | text | NN | |
| venue_zip | text | NN | |
| notes | text | | Optional additional context from customer |
| status | text | NN | `pending` `approved` `rejected` `instructor_assigned` — default: pending |
| rejection_reason | text | | Set when status = rejected |
| travel_fee | numeric | NN | Default: 65. Flat $65 travel & setup fee applied to customer-requested sessions. |
| session_id | uuid | FK | → class_sessions.id. Set when admin approves and creates the session. |
| created_at | timestamptz | NN | Default: now() |

---

## Bookings & Payments

### `bookings`
> A customer's spot in a class session.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| session_id | uuid | FK, NN | → class_sessions.id |
| customer_id | uuid | FK, NN | → profiles.id |
| invoice_id | uuid | FK | → invoices.id. Nullable. |
| booking_source | enum | NN | `online` `rollcall` `invoice` `manual` |
| team_booking_id | uuid | FK | → team_bookings.id. Nullable. Set when the booking came through a team link. Note these keep `booking_source = 'online'` so the existing duplicate-booking guard and unique index still apply. |
| created_by | uuid | FK | → profiles.id. Nullable — set when staff manually creates booking. |
| manual_booking_reason | text | | Required when booking_source = manual. |
| cancelled | boolean | NN | Default: false. |
| cancellation_note | text | | Required when cancelling. |
| cancelled_by | uuid | FK | → profiles.id. Nullable — set when staff cancels booking. |
| grade | int | | Nullable until instructor enters grade. |
| created_at | timestamptz | NN | Default: now() |
| updated_at | timestamptz | NN | Default: now() |

---

### `payments`
> Payment records. Loosely coupled to bookings.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| customer_id | uuid | FK, NN | → profiles.id |
| booking_id | uuid | FK | → bookings.id. Nullable. |
| logged_by | uuid | FK | → profiles.id. Nullable — set when staff manually logs payment. |
| amount | numeric(10,2) | NN | |
| status | enum | NN | `pending` `completed` `failed` |
| payment_type | enum | NN | `online` `cash` `check` `deposit` `invoice` |
| paypal_transaction_id | text | | Set for online PayPal payments |
| routing_note | text | | Audit note for online collections. Current online payments are collected by SuperHeroCPR and paid to instructors through payouts. |
| notes | text | | |
| created_at | timestamptz | NN | Default: now() |

---

### `team_bookings`
> A staff-created corporate/group class plus a shareable signup link.
> Staff create the class and this row from `/admin/sessions/new`, then hand the
> `/team/<share_token>` link to the company contact, who distributes it to their
> own employees. Each employee signs up with a real account so RollCall sees
> correct names. The same page lists who has signed up (first + last name only).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| session_id | uuid | FK, NN | → class_sessions.id. Usually a newly created private session; may point at an existing class. |
| company_name | text | NN | |
| contact_name | text | NN | The company's HR/office contact. |
| contact_email | text | NN | Receives the invoice in company mode. |
| contact_phone | text | | |
| payment_mode | text | NN, CHECK | `company` (flat total, invoiced) or `per_seat` (employee pays at signup). |
| price_per_seat | numeric(10,2) | | Set only in `per_seat` mode. Overrides class_types.price for signups through this link. |
| total_price | numeric(10,2) | | Set only in `company` mode. Flat amount — no per-head breakdown. |
| invoice_id | uuid | FK | → invoices.id. Set in `company` mode. Team invoices are written with `student_count = 0` so they never consume capacity in book_spot. |
| share_token | text | UQ, NN | Unguessable bearer credential in the public URL. |
| created_by | uuid | FK, NN | → profiles.id. Drives the cancellation phone shown publicly — an instructor-created booking shows that instructor's phone. |
| class_request_id | uuid | FK | → class_requests.id. Set when created via "Convert to team booking". |
| created_at | timestamptz | NN | Default: now() |

> **CHECK `team_bookings_price_shape_check`** — each mode must carry its own
> price and only its own price (`per_seat` → price_per_seat, `company` → total_price).
>
> **RLS** enabled with zero policies — all access via `createAdminClient()` in
> server API routes, matching the `promo_codes` / `addons` convention.

---

## Invoices

### `invoices`
> PayPal invoices sent from the SuperHeroCPR business account to individuals or companies.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| invoice_number | text | NN, UQ | e.g. "INV-00042". Used as roster upload lookup key. |
| class_session_id | uuid | FK, NN | → class_sessions.id. Must be approved. |
| instructor_id | uuid | FK, NN | → profiles.id |
| invoice_type | enum | NN | `individual` `group` |
| recipient_name | text | NN | |
| recipient_email | text | NN | |
| company_name | text | | Nullable — group invoices only |
| student_count | int | NN | |
| amount_per_student | numeric(10,2) | NN | Snapshot of class price at time of invoice |
| custom_price | boolean | NN | Default: false. True if instructor manually set total. |
| total_amount | numeric(10,2) | NN | Authoritative amount — auto or custom |
| payment_platform | enum | NN | `paypal` for new invoices. Older records may contain legacy platform values. |
| platform_invoice_id | text | | PayPal invoice ID |
| status | enum | NN | `sent` `paid` `cancelled` — default: sent |
| notes | text | | Optional message to recipient |
| paid_at | timestamptz | | |
| cancelled_at | timestamptz | | |
| created_at | timestamptz | NN | Default: now() |

---

### `instructor_earnings`
> One payout accounting row for each paid booking or paid invoice that generated instructor compensation.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| instructor_id | uuid | FK, NN | → profiles.id |
| source_type | text | NN | `booking` or `invoice` |
| booking_id | uuid | FK | → bookings.id. Set only for booking earnings. Unique when not null. |
| invoice_id | uuid | FK | → invoices.id. Set only for invoice earnings. Unique when not null. |
| payment_id | uuid | FK | → payments.id. Set for online booking payments. |
| gross_amount | numeric(10,2) | NN | Full amount collected from the customer. |
| platform_fee_percent | numeric(5,2) | NN | Percentage retained by SuperHeroCPR at time of earning. |
| platform_fee_amount | numeric(10,2) | NN | Dollar amount retained by SuperHeroCPR. |
| instructor_amount | numeric(10,2) | NN | Dollar amount owed to the instructor. |
| status | text | NN | `pending` `payout_pending` `paid` `cancelled` `failed` |
| payout_batch_id | uuid | FK | → instructor_payout_batches.id. Null until reserved. |
| payout_item_id | uuid | FK | → instructor_payout_items.id. Null until reserved. |
| notes | text | | Internal payout note. |
| created_at | timestamptz | NN | Default: now() |
| updated_at | timestamptz | NN | Default: now() |

---

### `instructor_payout_batches`
> A PayPal Payouts batch created from one or more pending instructor earnings.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| created_by | uuid | FK | → profiles.id. Super admin who initiated the payout. |
| status | text | NN | `pending` `submitted` `completed` `failed` |
| sender_batch_id | text | NN, UQ | Internal PayPal idempotency identifier. |
| paypal_payout_batch_id | text | | PayPal payout batch ID after submission. |
| total_amount | numeric(10,2) | NN | Sum of payout item amounts. |
| item_count | int | NN | Number of instructor payout items in the batch. |
| error_message | text | | PayPal or recovery error for admin review. |
| created_at | timestamptz | NN | Default: now() |
| submitted_at | timestamptz | | Set when PayPal accepts the batch. |
| completed_at | timestamptz | | Set when all PayPal payout items complete. |

---

### `instructor_payout_items`
> One grouped payout recipient inside a payout batch.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| payout_batch_id | uuid | FK, NN | → instructor_payout_batches.id |
| instructor_id | uuid | FK, NN | → profiles.id |
| recipient_email | text | NN | PayPal payout email used for this batch. |
| amount | numeric(10,2) | NN | Amount sent to the instructor. |
| status | text | NN | `pending` `submitted` `completed` `failed` |
| paypal_payout_item_id | text | | PayPal payout item ID after submission. |
| error_message | text | | PayPal item error for admin review. |
| created_at | timestamptz | NN | Default: now() |
| updated_at | timestamptz | NN | Default: now() |

---

### `invoice_activity_log`
> Audit trail for all invoice actions.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| invoice_id | uuid | FK, NN | → invoices.id |
| actor_id | uuid | FK, NN | → profiles.id |
| action | text | NN | e.g. "created" "sent" "marked_paid" "cancelled" "resent" |
| notes | text | | |
| created_at | timestamptz | NN | Default: now() |

---

## Rosters & Grading

### `roster_records`
> Students on the class roster — imported or self-registered via rollcall.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| session_id | uuid | FK, NN | → class_sessions.id |
| booking_id | uuid | FK | → bookings.id. Nullable. |
| first_name | text | NN | |
| last_name | text | NN | |
| email | text | | |
| phone | text | | |
| employer | text | | |
| grade | int | | Nullable until instructor enters grade |
| confirmed | boolean | NN | Default: false. Student confirmed their record. |
| corrected | boolean | NN | Default: false. Student made at least one change. |
| device_token | text | | Locks device to this record during correction window |
| created_at | timestamptz | NN | Default: now() |
| updated_at | timestamptz | NN | Default: now() |

---

### `roster_uploads`
> Customer-submitted roster spreadsheets awaiting manager import.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| invoice_id | uuid | FK, NN | → invoices.id. Lookup key used by customer on /submit-roster. |
| session_id | uuid | FK, NN | → class_sessions.id |
| file_url | text | NN | Stored in AWS S3 |
| original_filename | text | NN | |
| submitted_by_name | text | | |
| submitted_by_email | text | | |
| imported | boolean | NN | Default: false |
| created_at | timestamptz | NN | Default: now() |

---

### `preset_grades`
> Selectable grade values shown in the instructor grading tool.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| value | int | NN, UQ | e.g. 70, 80, 85, 90, 100 |
| label | text | NN | e.g. "Pass", "Fail", "Distinction" |
| created_at | timestamptz | NN | Default: now() |

---

## Merch

### `products`
> Merchandise catalog items.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| name | text | NN | |
| description | text | | |
| price | numeric(10,2) | NN | |
| image_url | text | | Stored in AWS S3 |
| active | boolean | NN | Default: true |
| low_stock_threshold | int | NN | Default: 5. Manager dashboard alert. |
| created_at | timestamptz | NN | Default: now() |

---

### `product_variants`
> Per-size stock tracking for each product.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| product_id | uuid | FK, NN | → products.id |
| size | text | NN | e.g. "S", "M", "L", "XL", "XXL", "One Size" |
| stock_quantity | int | NN | Default: 0. Decremented atomically via decrement_stock RPC. |
| created_at | timestamptz | NN | Default: now() |

---

### `orders`
> A customer's merch purchase.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| customer_id | uuid | FK, NN | → profiles.id |
| status | enum | NN | `pending` `paid` `shipped` `delivered` `cancelled` |
| total_amount | numeric(10,2) | NN | |
| paypal_transaction_id | text | | |
| shipping_name | text | NN | |
| shipping_address | text | NN | |
| shipping_city | text | NN | |
| shipping_state | text | NN | |
| shipping_zip | text | NN | |
| tracking_number | text | | Added by staff when shipped |
| notes | text | | Staff fulfillment notes |
| created_at | timestamptz | NN | Default: now() |
| updated_at | timestamptz | NN | Default: now() |

---

### `order_items`
> Individual line items within an order.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| order_id | uuid | FK, NN | → orders.id |
| variant_id | uuid | FK, NN | → product_variants.id |
| quantity | int | NN | Default: 1 |
| price_at_purchase | numeric(10,2) | NN | Snapshot of price at time of purchase |
| created_at | timestamptz | NN | Default: now() |

---

### `stock_adjustments`
> Audit log of all manual stock quantity changes made by super admins.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, NN | Default: gen_random_uuid() |
| variant_id | uuid | FK, NN | → product_variants.id |
| adjusted_by | uuid | FK, NN | → profiles.id — super admin who made the change |
| previous_quantity | int | NN | Stock quantity before the adjustment |
| new_quantity | int | NN | Stock quantity after the adjustment |
| notes | text | | Optional reason e.g. "Received new shipment" |
| created_at | timestamptz | NN | Default: now() |
