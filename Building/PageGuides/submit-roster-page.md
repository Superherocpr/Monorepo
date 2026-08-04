# Submit Roster Build Guide
**Route:** `/submit-roster`
**File:** `app/(public)/submit-roster/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/submit-roster` page for **Superhero CPR**. This is a public page — no login required — where a company contact submits their staff roster ahead of a group CPR class. They receive this link in their group invoice email. They enter their invoice number to identify the class, then upload a spreadsheet of their staff.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for confirmation email
- **AWS S3** — for file storage

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

This page is public — no auth guard.

---

## Context for the User

This page is visited by HR managers, office managers, or company contacts who are organizing CPR training for their staff. They may not be tech-savvy. The UI needs to be extremely clear — explain what the page is for, what the invoice number is, and exactly what file format is expected.

---

## Architecture

Client component — multi-step flow. File is uploaded to S3 via an API route.

---

## Pre-population from URL

If the invoice number is included as a query param (`?invoice=INV-00042`), pre-fill Step 1 and auto-advance to Step 2.

```typescript
const prefilledInvoice = searchParams.invoice ?? null
```

---

## Step 1 — Enter Invoice Number

**UI:**
- Page heading: `"Submit Your Class Roster"`
- Explanatory text:
  ```
  "If you received a group invoice for CPR training, use this page to submit
   your staff roster in advance. This helps us prepare for your class and
   saves time on the day.

   You'll need the invoice number from your invoice email."
  ```
- Invoice number input — large, monospace font, placeholder: `"e.g. INV-00042"`
- `"Find My Class"` button

**On submit — `POST /api/roster-upload/lookup`:**

```typescript
// Body: { invoiceNumber: string }
// Returns: {
//   valid: boolean,
//   session: { className, date, time, locationName, instructorName } | null,
//   invoiceId: string | null,
//   sessionId: string | null,
//   error?: string
// }
```

Server lookup:
```typescript
const { data: invoice } = await supabase
  .from('invoices')
  .select(`
    id, invoice_type, status,
    class_sessions (
      id, starts_at, ends_at,
      class_types ( name ),
      locations ( name, address, city, state ),
      profiles ( first_name, last_name )
    )
  `)
  .eq('invoice_number', invoiceNumber.trim().toUpperCase())
  .eq('invoice_type', 'group')
  .single()
```

**Error cases:**
- Invoice not found: `"We couldn't find an invoice with that number. Please check the invoice email and try again."`
- Invoice is individual (not group): `"This invoice doesn't require a roster. Individual bookings are managed separately."`
- Invoice is cancelled: `"This invoice has been cancelled. Please contact your instructor if you have questions."`

---

## Step 2 — Confirm Class Details

Show a confirmation card so the contact can verify they have the right class before uploading.

**UI:**
```
Class: [class type name]
Date:  [formatted date]
Time:  [formatted time]
Location: [location name], [city], [state]
Instructor: [instructor first + last name]
```

- `"This is my class"` button → advance to Step 3
- `"That's not right"` link → back to Step 1

---

## Step 3 — Upload Roster

**UI:**
- Heading: `"Upload your staff list"`
- Explanatory text:
  ```
  "Please upload a spreadsheet with your staff's information.
   We accept Excel (.xlsx) or CSV files.

   Required columns: First Name, Last Name
   Optional columns: Email, Phone, Employer/Department

   Column names don't need to match exactly — we'll help you map them."
  ```
- Drag and drop zone OR click to browse
- Accepts: `.csv`, `.xlsx`, `.xls`
- Max file size: 10MB
- Shows filename and row count after file is selected

**Optional fields:**
- `"Your name"` — who is submitting (for confirmation email and manager reference)
- `"Your email"` — to receive a confirmation that the file was received

**`"Submit Roster"` button** — disabled until file is selected

**On submit — `POST /api/roster-upload/submit`:**

```typescript
export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File
  const invoiceId = formData.get('invoiceId') as string
  const sessionId = formData.get('sessionId') as string
  const submittedByName = formData.get('submittedByName') as string | null
  const submittedByEmail = formData.get('submittedByEmail') as string | null

  // Validate file type and size
  const allowedTypes = [
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ]
  if (!allowedTypes.includes(file.type)) {
    return Response.json({ success: false, error: 'Invalid file type.' }, { status: 400 })
  }
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ success: false, error: 'File too large (max 10MB).' }, { status: 400 })
  }

  // Upload to S3
  const s3Key = `rosters/${invoiceId}/${Date.now()}-${file.name}`
  // ... S3 upload logic (same pattern as merch image upload)

  // Insert roster_upload record
  await supabase.from('roster_uploads').insert({
    invoice_id: invoiceId,
    session_id: sessionId,
    file_url: s3Url,
    original_filename: file.name,
    submitted_by_name: submittedByName || null,
    submitted_by_email: submittedByEmail || null,
    imported: false,
  })

  // Send confirmation email to submitter if email provided
  if (submittedByEmail) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'Superhero CPR <noreply@superherocpr.com>',
      to: submittedByEmail,
      subject: 'Your roster for [class] has been received',
      html: `
        <h1>Roster received!</h1>
        <p>Hi ${submittedByName ?? 'there'},</p>
        <p>We've received your staff roster for the upcoming CPR class.
           Our team will review it before class day.</p>
        <p>If you need to make changes, simply submit the updated file
           at superherocpr.com/submit-roster using the same invoice number.</p>
        <p>Invoice number: <strong>${invoiceNumber}</strong></p>
        <p>— The Superhero CPR Team</p>
      `,
    })
  }

  // Notify manager via Resend
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'Superhero CPR <noreply@superherocpr.com>',
    to: 'info@superherocpr.com',
    subject: `Roster submitted for [class] on [date]`,
    html: `
      <p>A customer has submitted a roster.</p>
      <p>Invoice: ${invoiceNumber}</p>
      <p>Class: [class name] on [date]</p>
      <p>Submitted by: ${submittedByName ?? 'Unknown'} (${submittedByEmail ?? 'no email provided'})</p>
      <p>File: ${file.name}</p>
      <p>Import the roster from the session detail page in the admin panel.</p>
    `,
  })

  return Response.json({ success: true })
}
```

---

## Step 4 — Confirmation

**UI:**
- Large green checkmark
- Heading: `"Roster submitted!"`
- Body:
  ```
  "Your staff list has been received. Our team will review it before class day.

   If you need to make any changes, you can resubmit using the same invoice number."
  ```
- If email was provided: `"A confirmation has been sent to [email]."`
- `"Submit another roster"` link → back to Step 1

---

## Resubmission

A customer can submit multiple times for the same invoice. Each submission creates a new `roster_uploads` record. The manager sees the most recent unimported upload in the session detail banner. Old uploads remain in the DB for reference.

There is no "replace" mechanism — the manager always imports from the latest upload.

---

## Responsive

- Mobile: Single column, generous padding
- Desktop: Centered, max width `lg`

The page should feel clean and reassuring — this is likely being filled out by someone who isn't very technical and may be a little anxious about getting it right.

---

## What NOT to Do

- Do not require login — fully public
- Do not parse the spreadsheet server-side — just store the file. The manager imports it via the roster import tool.
- Do not limit to one submission per invoice — allow resubmission
- Do not block on missing optional fields (submitter name/email) — they are truly optional
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Page is public — no auth required
- [ ] `?invoice=` query param pre-fills invoice number and auto-advances
- [ ] Step 1: Invoice number lookup works — validates group invoice exists and is not cancelled
- [ ] Invalid invoice numbers show specific helpful error messages
- [ ] Step 2: Class details shown correctly for confirmation
- [ ] Step 3: File upload accepts CSV and Excel, rejects other types, enforces 10MB limit
- [ ] Submitter name and email are optional
- [ ] File uploaded to S3 via API route
- [ ] `roster_uploads` record created correctly
- [ ] Confirmation email sent to submitter if email provided
- [ ] Manager notification email sent
- [ ] Step 4: Confirmation shown with resubmit option
- [ ] Resubmission works — creates new record without error
- [ ] Mobile-friendly, clean, reassuring design
- [ ] No TypeScript errors
- [ ] No ESLint errors
