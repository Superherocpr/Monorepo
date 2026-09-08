# SuperHero CPR — Manager Guide

This guide covers everything a manager can do on the SuperHero CPR platform. Managers have access to all instructor capabilities plus the ability to approve sessions, manage customers, view all payments, manage locations, reply to contact submissions, and import class rosters.

Managers access the admin area by signing in at `/signin`. You'll land at `/admin` automatically.

---

## Table of Contents

1. [Your Dashboard](#1-your-dashboard)
2. [Sessions — Viewing All Classes](#2-sessions--viewing-all-classes)
3. [Instructor Requests — Session Approvals](#3-instructor-requests--session-approvals)
4. [Session Detail — Full Access](#4-session-detail--full-access)
5. [Importing a Roster](#5-importing-a-roster)
6. [Invoices — Full Management](#6-invoices--full-management)
7. [Customer Management](#7-customer-management)
8. [Payments Ledger](#8-payments-ledger)
9. [Locations](#9-locations)
10. [Contact Submissions](#10-contact-submissions)

---

## 1. Your Dashboard (`/admin`)

Your manager dashboard gives you an operational overview of the business.

### Pending Approvals
A count badge showing how many instructor-submitted sessions are waiting for your review. Click it to go to the approvals queue.

### Today's Classes
All approved sessions happening today, across all instructors. Each entry shows the class date/time, class name, location, instructor name, and enrollment vs. capacity. Use this to keep an eye on who's teaching what.

### Recent Bookings
The last 5 non-cancelled bookings from any customer. Shows the customer's name, the class they booked, how they booked (online), and when the booking was made. Good for spotting a surge in bookings or an unusual pattern.

### Unanswered Contact Submissions
A count badge showing how many contact form submissions haven't been replied to yet. Click it to go to the contact submissions page.

### Low Stock Alert
Any merchandise variants (products in specific sizes) where stock has fallen at or below the configured low-stock threshold. Shows the product name, size, current stock count, and the threshold. Use this to know when to reorder inventory.

---

## 2. Sessions — Viewing All Classes (`/admin/sessions`)

This page shows all class sessions across every instructor, organized by month and sorted by date. Columns include:
- Date and time
- Class type
- Location
- Status (Draft / Scheduled / Completed)
- Approval status (Pending Approval / Approved / Rejected) and rejection reason
- Capacity and spots remaining
- Instructor name

**Filtering:** Narrow by class type, location, instructor, approval status, or session status using the filter controls.

> Unlike instructors, who only see their own sessions, you see all sessions from all instructors.

---

## 3. Instructor Requests — Session Approvals (`/admin/sessions/approvals`)

Instructors cannot make their sessions visible to the public until a manager or super admin approves them. This page is your review queue.

### The Instructor Requests Queue

Sessions are split into two groups:
1. **Resubmissions** — sessions that were previously rejected and have been resubmitted after corrections. These appear first so they aren't overlooked.
2. **New Submissions** — sessions submitted for the first time.

Both groups are sorted with the longest-waiting sessions at the top.

Each card shows the session's date and time, class name, instructor name, and location. If the session was previously rejected, the rejection reason from that review is displayed.

### Approving a Session
Click any session card to open its detail page. On the detail page you'll find **Approve** and **Reject** action buttons.

Click **Approve** to mark the session as approved. It immediately becomes visible on the public booking page (`/book`).

### Rejecting a Session
Click **Reject** and enter a rejection reason. Be specific — the instructor will see this reason on their session detail page and on their dashboard. The session is returned to the instructor for correction and resubmission.

---

## 4. Session Detail — Full Access (`/admin/sessions/[id]`)

You have full access to every session's detail page regardless of which instructor created it.

### What You Can See
- The session's full details (class type, location, dates, capacity, notes, status, approval status)
- The **bookings table** — all online customers who booked, including their name, contact info, payment status, and grade
- The **roster records table** — all students who checked in via roll call or were imported from a group roster
- **Invoices** associated with this session
- **Roster upload history** — records of any CSV imports done for this session

### What You Can Do
- **Edit session details** — change class type, location, instructor, dates, capacity, or notes
- **Approve or reject** the session (Approve / Reject buttons)
- **Enroll a customer** — add an ad-hoc booking for a customer without going through the public checkout
- **Create an invoice** — see [Invoicing](#6-invoices--full-management)
- **Navigate to the grading tool** to record student grades
- **Navigate to the roster import page** to import a CSV roster for this session

---

## 5. Importing a Roster (`/admin/sessions/[id]/roster`)

This tool lets you import a list of students for a session from a CSV file. It's used for group/corporate clients whose HR team submits a list of participants.

### The Import Workflow

**Step 1 — Upload CSV or paste data**
Upload a CSV file or paste CSV text. The expected columns are: First Name, Last Name, Email, Phone, Employer.

If a group contact has already submitted a roster through the public `/submit-roster` page, it will appear here as a **Pending Upload** card. You can import it directly without uploading a new file.

**Step 2 — Preview imported data**
Review the parsed rows. Each row shows the student's name, email, phone, and employer as they'll be recorded.

**Step 3 — Review duplicates and conflicts**
If any students are already on the roster (same email), you'll be shown the conflicts and given options for how to handle each one: skip the duplicate, override the existing record, or add anyway.

**Step 4 — Confirm and import**
Review the final import summary and click **Confirm** to complete the import. Roster records are created for each student.

After import, students who were submitted via the `/submit-roster` page will receive a personalized link to `/roster/[session_token]` where they can review and correct their own information before class day. There is a correction deadline — the window closes before the class starts.

---

## 6. Invoices — Full Management (`/admin/invoices`)

Managers have full control over all invoices, from any instructor.

### Invoice List
The invoices list shows all invoices site-wide (not scoped by instructor). Columns include:
- Invoice number, type, and status
- Recipient name, email, and company
- Number of students and total amount
- Payment platform used
- Class session and instructor
- Creation, payment, and cancellation dates

**Filtering:** Filter by status, invoice type, date range, instructor, or class session.

### Invoice Actions
Click any invoice to open its detail page. From there you can:

- **Resend** — email the invoice to the recipient again (useful if it went to spam or the contact changed)
- **Mark as Paid** — manually record that payment was received outside the platform (e.g., check or bank transfer)
- **Cancel** — cancel the invoice and release the reserved spots back to the session capacity
- **Edit Notes** — add or update internal notes visible to staff

All actions are logged in the invoice's activity log with a timestamp and the name of the staff member who took the action.

---

## 7. Customer Management (`/admin/customers`)

This page is your central view of all registered customers on the platform.

### The Customer List
The list loads the first 50 customers sorted alphabetically by last name. Each row shows:
- Full name, email address, and phone
- Account creation date
- Active / archived status
- Number of upcoming bookings
- Number of total bookings
- Number of active certifications
- An "Expiring Soon" badge if any of their certifications expire within the next 90 days

**Searching and filtering:** Use the search box to filter by name. Use the status filter to see only active or only archived accounts. Use the certifications filter to show customers who have certifications or who have one expiring soon.

### Customer Detail
Click any customer to open their detail view. Here you can:

- **View and edit** their full profile (name, email, phone, address)
- **View their booking history** — all past and upcoming bookings
- **View their certifications** — active and expired
- **Archive the account** — archived customers can still be found in the customers list with the "Archived" filter, or on the dedicated archived page. They lose access to the site.
- **Restore an archived account** — if you previously archived a customer in error

---

## 8. Payments Ledger (`/admin/payments`)

This page is a full record of every payment associated with the platform — online bookings, manually recorded cash or check payments, deposits, and invoice payments.

### Summary Stats
At the top of the page, you'll see this month's revenue broken into two lines:
- **Online + Invoice revenue** — payments captured through PayPal or recorded as invoice payments
- **Cash + Check + Deposit revenue** — manually recorded payments

### Payment Table
The full list is paginated at 50 entries per page. Each row shows:
- Customer name and email
- Amount, payment type (online / cash / check / deposit / invoice), and status
- PayPal transaction ID (if applicable)
- The session the payment was for (date and class name)
- Which instructor the session belongs to
- Which staff member logged the payment
- Notes and routing note
- Payment date

### Filtering
You can filter by:
- **Payment type** — online, cash, check, deposit, or invoice
- **Status** — completed, pending, or failed
- **Date range** — from and to dates
- **Customer** — search by name or email
- **Instructor** — search by instructor name

### Payment Detail
Click any payment to see full detail and, if needed, edit the amount, status, type, or notes.

---

## 9. Locations (`/admin/locations`)

Manage the physical venues where classes are held.

### Location List
The list shows up to 10 locations, sorted with the home base location first, then alphabetically by name. Each entry shows:
- Location name, address, city, state, and ZIP
- Notes (optional)
- Whether it's marked as the **home base**
- How many sessions are scheduled at that location

### Managing Locations

**Adding a location:** Click **Add** and fill in the name, address, city, state, ZIP, and optional notes. Toggle the **Home Base** flag if this is your primary teaching location.

**Editing a location:** Click any location to edit its details.

**Deleting a location:** A location can only be deleted if no sessions are scheduled there. If sessions exist, you must reassign or delete those sessions first.

**Home Base flag:** Only one location should be marked as the home base. This is used as the default location in certain parts of the platform.

---

## 10. Contact Submissions (`/admin/contact`)

All messages submitted through the public `/contact` page land here. This is your inbox for customer inquiries.

### Viewing Submissions
Submissions are displayed as an accordion list. The header shows the badge count of unanswered messages. Each submission, when expanded, shows:
- Customer name, email, and phone
- Inquiry type (General Question / Group Booking / Corporate Training / Certification Renewal / Other)
- The full message text
- When it was submitted
- Whether it has been replied to
- Any previous reply thread

### Filtering
Narrow the list by:
- **Inquiry type** — filter to see only group booking inquiries, corporate training, etc.
- **Status** — show only unreplied or only replied submissions
- **Date range** — from and to dates

### Replying to a Submission

Replies are sent via **Zoho Mail**. If Zoho Mail is connected to the platform (configured in Settings by a super admin), a **Reply** button appears on each submission.

Click **Reply**, type your message, and send. The reply is sent to the customer's email address, logged in the submission's thread, and the submission is marked as replied.

If Zoho Mail is not connected, you'll see a notice that replies are unavailable and you'll need to respond manually outside the platform.
