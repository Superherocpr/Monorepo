# SuperHero CPR — Instructor Guide

This guide covers everything an instructor can do inside the admin area of the SuperHero CPR platform: managing your class sessions, viewing your students, grading, invoicing, connecting your payment account, and using the Enrollware bookmarklet.

Instructors access the admin area by signing in at `/signin`. You'll be taken to `/admin` automatically after sign-in.

---

## Table of Contents

1. [Your Dashboard](#1-your-dashboard)
2. [Managing Sessions](#2-managing-sessions)
3. [Session Detail](#3-session-detail)
4. [Grading Students](#4-grading-students)
5. [Invoicing](#5-invoicing)
6. [Connecting Your Payment Account](#6-connecting-your-payment-account)
7. [Enrollware Bookmarklet](#7-enrollware-bookmarklet)
8. [Settings Access](#8-settings-access)

---

## 1. Your Dashboard (`/admin`)

Your dashboard gives you a snapshot of today's activity and outstanding tasks at a glance.

### Today's Classes
A list of all your sessions starting today — class name, time range, location, how many students are enrolled vs. the session capacity. Use this as a quick reference before heading to class.

### Pending Grades
Any sessions you've completed but haven't fully graded yet. Each entry shows the session date, class name, and how many students still don't have a grade recorded. Click any entry to go directly to the grading tool for that session.

### Pending Invoices
Your most recently sent invoices that are still waiting on payment. Shows the recipient name, the total amount, the class session the invoice is for, and when it was sent. Click any row to open the invoice detail.

### Daily Access Code
Your current daily access code is shown on the dashboard. This is the 6-digit code you give students on class day so they can check in via `/rollcall`. The code resets daily.

---

## 2. Managing Sessions (`/admin/sessions`)

This page lists all of your class sessions. Each row shows:
- Session date and time
- Class type
- Location
- Status: **Draft**, **Scheduled**, or **Completed**
- Approval status: **Pending Approval**, **Approved**, or **Rejected** (with rejection reason if applicable)
- Total capacity and spots remaining

**Filtering:** You can narrow the list by class type, location, or approval status.

> You only see your own sessions. Managers and super admins can see all sessions across all instructors.

### Creating a New Session (`/admin/sessions/new`)

Click the button to create a new session. Fill in:
- **Class type** — select from the active course catalog (the type controls the default duration and capacity)
- **Location** — select where the class will be held
- **Start date and time**
- **End date and time**
- **Max capacity** — defaults from the class type, but can be adjusted
- **Notes** — optional internal notes

Submit the form to create the session. New sessions start as **Pending Approval** and will not appear on the public booking page until a manager or super admin approves them.

### Session Statuses Explained

| Status | What it means |
|---|---|
| Draft | Created but not yet visible or bookable |
| Scheduled | Approved and open for bookings |
| Completed | The class date has passed |
| Pending Approval | Submitted and waiting for manager/super admin review |
| Approved | Cleared to be listed publicly |
| Rejected | Returned with feedback — check the rejection reason and resubmit |

---

## 3. Session Detail (`/admin/sessions/[id]`)

Clicking any session opens its detail page. This is where you manage everything for a specific class.

### Session Information
At the top you'll see the session's dates, status, approval status, capacity, and how many students are enrolled. If the session was rejected, the rejection reason is shown here.

### Editing Session Details
You can edit the class type, location, start/end times, capacity, and notes at any time. Click **Save** after making changes.

### Bookings
A table of all customers who booked this session online. For each booking you can see:
- Customer name, email, and phone
- How they booked (online)
- Their grade (once graded)
- Payment status, type, and amount paid

### Roster Records
Separate from online bookings, this table shows students who were checked in via roll call or imported via a group roster. Columns include first name, last name, email, phone, employer, grade, and whether their information was confirmed.

### Invoices
Any invoices you've created for this session are listed here. See [Invoicing](#5-invoicing) for details.

### Submitting to Enrollware
Once a session is complete and graded, you can submit it to Enrollware (the AHA certification system). The **"Send to Enrollware"** button is available on sessions that haven't been submitted yet. Use the Enrollware Bookmarklet tool (see below) for the most efficient submission workflow.

---

## 4. Grading Students (`/admin/sessions/[id]/grades`)

After a class is complete, use the grading tool to record each student's result.

Access grading from the session detail page by clicking the grading link, or directly from the **Pending Grades** widget on your dashboard.

### How Grading Works

The page shows a list of every student on the session roster (from roster records — not from online bookings, which are tracked separately). For each student you see their name, email, and current grade.

**To grade a student:**
- Click one of the **preset grade buttons** (e.g., Pass, Fail, Incomplete) to assign a grade instantly, or
- Type a numeric grade directly into the input field

Preset grades are configured by a super admin and typically represent the standard outcomes for your course type.

Save all grades when done.

---

## 5. Invoicing (`/admin/invoices`)

Invoices are how you bill organizations and groups for CPR training. Unlike online bookings, invoiced students don't pay through the website — payment is handled separately through your connected payment platform.

### Viewing Your Invoices

The invoices list shows all invoices you've created, with columns for:
- Invoice number
- Recipient name and email
- Company name
- Number of students
- Total amount
- Status: **Sent**, **Paid**, or **Cancelled**
- Payment platform
- Class session info
- When it was created

You can filter by status, invoice type, date range, and class session.

### Creating an Invoice (`/admin/invoices/new`)

Before you can create an invoice, you must have an active payment account connected (see [Connecting Your Payment Account](#6-connecting-your-payment-account)). If you don't, you'll see a prompt to connect one first.

**To create an invoice:**

1. Select the **class session** you're invoicing for. The dropdown shows your approved upcoming sessions, including how many spots remain.
2. Fill in the recipient details:
   - **Recipient name** (person or company name)
   - **Email address** (where the invoice will be sent)
   - **Number of students** (how many seats are being reserved)
   - **Amount per student** (auto-filled from the class type price, but editable)
   - **Notes** (optional — visible to the recipient)
3. Submit to create and send the invoice.

Once submitted, the invoice is emailed to the recipient and its status is set to **Sent**. Student count from the invoice immediately counts against the session's available spots, even before payment — this prevents overbooking.

### Invoice Detail (`/admin/invoices/[id]`)

Clicking an invoice shows its full detail: recipient info, amounts, session details, location, and an **activity log** showing every action taken on the invoice (when it was created, sent, paid, etc.).

> As an instructor, you can view your invoices in full. Resending, marking as paid, and cancelling invoices require manager or super admin access.

---

## 6. Payout Settings (`/admin/profile/payment`)

To create invoices and receive instructor payouts, you must save the PayPal email address where SuperHeroCPR should send your payout. Students pay SuperHeroCPR first; your instructor earnings are recorded automatically when bookings or invoices are paid.

### Saving Your PayPal Payout Email

1. Go to `/admin/profile/payment`
2. Enter the email address tied to the PayPal account where you want payouts sent
3. Click **Save payout email**
4. Confirm the page shows that you are ready for payouts

You are responsible for keeping this email accurate. If it is missing or incorrect, payouts may be delayed or rejected by PayPal.

### How Payments Reach You

SuperHeroCPR keeps the configured platform fee and pays the remaining instructor amount through PayPal Payouts. Super admins review pending earnings and send payout batches from the admin payout dashboard.

> If you don't have a payout email saved, you cannot create new invoices. Contact a super admin if you're having trouble.

---

## 7. Enrollware Bookmarklet (`/admin/enrollware-tool`)

Enrollware is the American Heart Association's system for recording completed courses and issuing certifications. This tool helps you submit class data to Enrollware faster by auto-filling the Enrollware web form with your student data.

### Setting Up the Bookmarklet

1. Click **"Generate Bookmarklet"** to create your personal API key
2. A bookmarklet link appears — drag it to your browser's bookmarks bar, or right-click to bookmark it
3. The bookmarklet is now ready to use whenever you open Enrollware

### Using the Bookmarklet

When you're logged into Enrollware and have a class ready to submit:

1. Navigate to the Enrollware class entry page
2. Click the bookmarklet in your bookmarks bar
3. The bookmarklet fetches today's class data from the SuperHero CPR site and fills in the student fields automatically

The **Today's Classes** section at the top of this page shows all sessions scheduled for today. Each shows the class name, time, location, student count, and whether the session has already been submitted to Enrollware. Use this as your at-a-glance reference before opening Enrollware.

### Revoking the Bookmarklet

If you need to reset access (e.g., you suspect your key was compromised), click **"Revoke Key"**. Your existing bookmarklet will stop working and you can generate a new one.

---

## 8. Settings Access (`/admin/settings`)

Instructors have limited access to the settings page. You can see and use:
- **Enrollware Bookmarklet section** — generate, copy, and revoke your bookmarklet key (same functionality as `/admin/enrollware-tool`)

Class types, payment routing, Zoho Mail, and other system settings are super admin only and are not visible to you.
