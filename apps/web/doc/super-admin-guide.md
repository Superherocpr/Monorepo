# SuperHero CPR — Super Admin Guide

This guide covers everything a super admin can do on the SuperHero CPR platform. Super admins have full control over the site — they can do everything a manager can do, plus manage staff, certifications, merchandise, orders, analytics, and all system settings.

Sign in at `/signin`. You'll land at `/admin` automatically.

---

## Table of Contents

1. [Your Dashboard](#1-your-dashboard)
2. [Sessions and Approvals](#2-sessions-and-approvals)
3. [Staff Management](#3-staff-management)
4. [Certifications](#4-certifications)
5. [Merchandise and Products](#5-merchandise-and-products)
6. [Orders](#6-orders)
7. [Analytics](#7-analytics)
8. [Instructor Payouts](#8-instructor-payouts)
9. [Invoices](#9-invoices)
10. [Customer Management](#10-customer-management)
11. [Archived Customers](#11-archived-customers)
12. [Payments Ledger](#12-payments-ledger)
13. [Locations](#13-locations)
14. [Contact Submissions](#14-contact-submissions)
15. [System Settings](#15-system-settings)

---

## 1. Your Dashboard (`/admin`)

Your super admin dashboard shows a comprehensive overview of the business at a glance.

### This Month's Stats
Four headline numbers at the top of the page:
- **Active Customers** — the count of non-archived customer accounts
- **Classes Scheduled** — total approved sessions this month
- **Online Revenue** — total from PayPal payments this month
- **Invoice Revenue** — total from invoice payments this month

### Unified Activity Feed
The last 10 events across all activity types combined into a single stream: new bookings, new payments, new invoices, and new customer registrations. Each item shows the event type, who it involved, the amount (if applicable), and when it happened. This gives you a real-time sense of what's happening across the business without going to separate pages.

### Pending Approvals Badge
A count of sessions waiting for review. Click to go to the approvals queue (`/admin/sessions/approvals`).

### Today's Classes
All sessions across all instructors happening today, with class name, time, location, instructor, and enrollment vs. capacity.

### Unanswered Contact Submissions
A count of unreplied contact form messages.

### Low Stock Alert
Merchandise variants at or below their configured low-stock threshold.

### Daily Access Code
The 6-digit code currently active for roll call check-ins. The code is shown here and changes automatically each day via a scheduled cron job.

---

## 2. Sessions and Approvals

Super admins have full session management. See the [Manager Guide — Sessions](manager-guide.md#2-sessions--viewing-all-classes) and [Instructor Requests](manager-guide.md#3-instructor-requests--session-approvals) sections for the full workflow — behavior is identical for super admins.

The one difference: super admins can also edit the **class type** assigned to a session, which instructors and managers cannot change after creation.

---

## 3. Staff Management (`/admin/staff`)

This section lets you manage all staff accounts: instructors, managers, other super admins, and inspectors.

### The Staff List
The list shows all staff members with their:
- Name, profile photo, and email
- Role (Instructor / Manager / Super Admin / Inspector)
- Account status (Active or Deactivated)
- Whether a bio is published on the public About page
- Whether they have a payment account connected
- Date added

### Viewing a Staff Member's Profile
Click any staff member to open their profile. From here you can see and manage everything about them.

### Editing Staff Details

You can update:
- **First and last name**
- **Email address**
- **Phone number**
- **Role** — change an instructor to a manager, or vice versa. Use caution: changing a role changes what the person can do on the platform.

### Managing a Bio

Each staff member can have a public bio shown on the About page. The bio fields are:
- **Title** — their job title or credential summary line shown beneath their name
- **Bio text** — a paragraph describing them
- **Profile photo** — upload a headshot. Images are stored in S3 and served from there.
- **Credentials** — a list of certifications, licenses, or training credentials displayed on the About page. Each credential has a title, issuing organization, and optional year.
- **Stats** — optional numbers shown on the About page (e.g., "Years of experience: 12", "Students trained: 500+")
- **Published** — toggle to control whether the bio appears publicly. Unpublished bios are stored but not shown.

### Deactivating and Reactivating Staff
Click **Deactivate** on a staff member's profile to block their access to the admin area. A deactivated account cannot sign in. Their data (sessions, invoices, bookings they're associated with) is preserved.

Click **Reactivate** to restore access.

> You cannot deactivate your own account.

### Creating a New Staff Member

Click **"Add Staff"** to open the new staff form. Fill in:
- First and last name
- Email address
- Role
- Password (they can change it after first login)

The new account is created and the person can immediately sign in. Send them their login credentials separately.

### Payment Routing

Each instructor has a payment routing setting that determines where invoice payments flow:
- **Direct** — payments go to the instructor's personal connected PayPal
- **Business** — payments route to the company's PayPal account instead

This setting is managed here on the staff profile page. See also [System Settings — Payment Routing](#payment-routing-table) for the full routing configuration.

---

## 4. Certifications (`/admin/certifications`)

This section manages certification records and the catalog of certification types.

### The Certifications List

Paginated list of all issued certifications across all customers. Each row shows:
- Customer name and email
- Certification type
- Issue date and expiration date
- Status (Active or Expired)
- Whether renewal reminders are paused for this certification

**Filtering:** Filter by certification type, customer, or status.

### Issuing a Certification

Click **"Issue Certification"** to manually create a cert record for a customer. Fill in:
- Customer (search by name or email)
- Certification type
- Issue date
- Expiration date (auto-calculated based on cert type's validity period, but editable)
- Card number (the AHA eCard ID, if applicable)

On save, the certification is added to the customer's account. They can see it at `/certifications` and access their eCard link if a card number is provided.

### Editing a Certification

Click any certification to open it for editing. You can update the card number, issue date, expiration date, or certification type.

### Deleting a Certification

On the certification detail, click **Delete** to permanently remove the record. This action cannot be undone. The customer will lose access to this certification in their account.

### Pausing Renewal Reminders

Each certification record has a **"Pause Reminders"** toggle. When paused, the automated renewal reminder emails won't fire for that specific certification. Use this when a customer has already renewed through another channel and you don't want to send redundant emails.

### Managing Certification Types

The **Cert Types** tab (or sub-page) shows the catalog of certification types you offer. Each type has:
- Name (e.g., "BLS Provider", "Heartsaver CPR/AED")
- AHA identifier
- Validity period in months (controls how long a cert is valid before expiring)
- Whether it's active (inactive types don't appear in the issue form)

Add, edit, or deactivate cert types from this section.

---

## 5. Merchandise and Products (`/admin/merch`)

Manage the physical products sold in the shop at `/merch`.

### The Product List
All products with their name, price, status (active/inactive), and current total stock across all variants. Products that have a variant at or below the low-stock threshold are flagged.

### Adding a Product

Click **"Add Product"** and fill in:
- **Product name**
- **Description** — shown on the shop page
- **Price** (base price; variants can override this)
- **Active** toggle — inactive products are hidden from the shop

After creating the product, add variants.

### Managing Variants

A variant is a specific version of a product — typically a size (S, M, L, XL) or a style option. Each variant has:
- **Label** (e.g., "Small", "Medium", "XL")
- **Price** (optional override of the product's base price)
- **Stock count** — the current inventory level
- **Low stock threshold** — when stock falls to or below this number, the variant appears in the Low Stock alert on the dashboard
- **Active** toggle — deactivating a variant hides it from the shop without deleting it

**Add a variant:** Click **"Add Variant"** on the product, fill in the fields, and save.
**Edit a variant:** Click the variant row to open and edit.
**Remove a variant:** Use the delete button on the variant. Cannot be deleted if orders reference it.

### Product Images

Each product can have images. Click **"Upload Image"** to select a file from your computer. Images are uploaded directly to S3 and the URL is stored in the database. Uploaded images are shown as thumbnails on the product page.

Images can be removed individually.

### Deactivating a Product

Toggle **Active** to off on a product to hide it from the shop without deleting it. Orders that already reference the product are not affected.

---

## 6. Orders (`/admin/orders`)

When customers purchase merchandise through the shop, the order appears here.

### The Orders List

Paginated at 20 orders per page. Each row shows:
- Order number and date
- Customer name and email
- Line items (product name, size, quantity)
- Order total
- Payment status (Paid / Pending / Refunded)
- Fulfillment status (Unfulfilled / Fulfilled / Cancelled)
- Shipping address
- Tracking number (if added)

**Filtering:** Filter by fulfillment status, payment status, or date range.

### Managing an Order

Click any order to open its detail view. From here you can:

- **Update fulfillment status** — mark as Fulfilled or Cancelled
- **Add tracking information** — enter a tracking number and carrier
- **Add or edit order notes** — internal notes visible only to staff
- **View the full order breakdown** — each line item, subtotal, tax, and total

All updates are logged. The customer does not receive an automatic notification when you update an order — contact them separately if needed.

---

## 7. Analytics (`/admin/analytics`)

The analytics page gives you a historical view of the business using a date range you control.

### Date Range Picker
Set the start and end date. All metrics on the page recalculate for that range.

### Key Metrics
A set of summary cards:
- Total bookings (non-cancelled)
- Total online revenue
- Total invoice revenue
- Total merch revenue
- New customer registrations
- Sessions held

### Charts
Time-series charts showing:
- Bookings over time (line chart)
- Revenue over time, broken out by type — online, invoice, merch (stacked line or bar chart)
- Customer growth (cumulative)

Use the analytics page to identify busy periods, revenue trends, and the impact of new class types or promotions.

---

## 8. Instructor Payouts (`/admin/payouts`)

This page is where you review pending instructor earnings and send out PayPal payout batches. Only super admins can access this page.

### How Instructor Earnings Accumulate

Whenever a customer pays for a booking or an invoice is marked paid, the system automatically calculates and records an earning for the instructor who ran that session. Each earning captures:
- The gross amount (what the customer paid)
- The platform fee (SuperHeroCPR's cut)
- The instructor amount (what the instructor receives)

Earnings sit as **pending** until you send a payout batch.

### Pending Payouts

The top section of the page groups pending earnings by instructor. Each row shows:
- Instructor name and email
- The PayPal email where their payout will be sent
- Total pending gross, platform fee, and instructor payout amount
- Number of individual earning records included

**Instructors missing a PayPal payout email** are flagged separately — their earnings accumulate but cannot be paid out until they save a payout email on their profile page (`/admin/profile/payment`).

### Sending a Payout Batch

1. Review the pending amounts to confirm they look correct
2. Click **"Send Payouts"** to initiate a PayPal Payouts batch for all eligible instructors
3. The system submits the batch to PayPal and records the batch in the payout history

PayPal processes the batch and deposits funds into each instructor's PayPal account. The status updates automatically once PayPal confirms the batch.

### Payout Batch History

The lower section shows all past payout batches, sorted most recent first. Each batch record shows:
- Batch ID and PayPal batch reference
- Status (Pending / Completed / Failed)
- Total amount and number of payees
- When it was submitted and completed
- Error message if the batch failed

---

## 9. Invoices

Full invoice management — same as described in the [Manager Guide — Invoices](manager-guide.md#6-invoices--full-management) section. Super admins can view, resend, mark paid, cancel, and edit all invoices.

---

## 10. Customer Management

Full customer management — same as described in the [Manager Guide — Customer Management](manager-guide.md#7-customer-management) section.

---

## 11. Archived Customers (`/admin/archived`)

This page shows every customer account that has been archived.

### The Archived List
Each row shows:
- Customer name and email
- Date archived
- Total number of bookings they ever made
- Number of certifications on their account
- Total amount they ever spent

This context helps you decide whether to restore or permanently delete the account.

### Restoring an Account
Click **Restore** on any archived customer to reactivate their account. They'll be able to sign in again and all their booking and certification history will be visible to them.

### Permanently Deleting an Account
Click **Delete** to permanently and irreversibly remove the customer's account and all their data. A confirmation dialog requires you to acknowledge this is permanent before proceeding.

> Only use Delete when you're certain the account and its history are no longer needed. Restoring is always the safer option.

---

## 12. Payments Ledger

Full payments access — same as described in the [Manager Guide — Payments Ledger](manager-guide.md#8-payments-ledger) section.

---

## 13. Locations

Full location management — same as described in the [Manager Guide — Locations](manager-guide.md#9-locations) section.

---

## 14. Contact Submissions

Full contact submission management — same as described in the [Manager Guide — Contact Submissions](manager-guide.md#10-contact-submissions) section.

---

## 15. System Settings (`/admin/settings`)

This is the control center for the entire platform. Super admins have full access to all settings.

### Class Types

The catalog of CPR and first aid courses you offer. Each class type has:
- **Name** — what's shown to customers in the booking flow and on schedules
- **Duration** — how long the class runs (used to auto-fill session end times)
- **Capacity** — default max students per session (can be overridden on individual sessions)
- **Price** — the online booking price. Also used as the default price in invoice creation.
- **AHA identifier** — the American Heart Association course code (used with Enrollware)
- **Active** — inactive class types don't appear in new session creation or the booking flow

**Add:** Click **"Add Class Type"** and fill in the fields.
**Edit:** Click any class type to edit it.
**Deactivate / Delete:** Toggle Active off to hide from use. Deletion is blocked if sessions reference the class type.

### Preset Grades

The list of quick-select grade options shown to instructors on the grading tool. These represent common outcomes (e.g., "Pass", "Fail", "No Show", "Incomplete").

Each preset has a label and an optional numeric value.

**Add, edit, or remove** presets from this section. Removing a preset doesn't change grades that were already recorded using it.

### Payment Routing Table

This table controls where invoice payments are routed for each instructor: to their own connected PayPal (Direct) or to the business PayPal account (Business).

The table shows every instructor with a connected payment account and their current routing setting. Click any row to toggle the routing for that instructor.

> This affects where money goes when a customer pays an invoice. If an instructor is set to Business routing, the business PayPal receives the payment even though the invoice was created by that instructor.

### Zoho Mail

Connect Zoho Mail to the platform to enable email-based replies to contact form submissions.

**To connect:**
1. Click **"Connect Zoho Mail"**
2. You'll be redirected to Zoho's authorization page
3. Log in and approve the connection
4. You'll be returned and Zoho Mail will show as connected with the authorized email address

**To disconnect:** Click **"Disconnect"**. This removes the token. Existing replied threads are not affected, but new replies through the platform won't work until reconnected.

### Enrollware Bookmarklet (Settings)

Same bookmarklet management as visible to instructors on `/admin/settings` — generates and revokes the bookmarklet key. In the settings page context, this gives super admins visibility into the tool from the same place they manage everything else.

### Legacy Site Toggle

A switch that, when turned on, adds a banner or redirect indicator pointing users to the old WordPress site. Use this as a temporary measure if you need to redirect traffic back to the legacy site during a maintenance window.

> This is a temporary operational control. It doesn't actually change DNS — it only affects what the Next.js app displays to visitors.
