# Admin Certifications Build Guide
**Route:** `/admin/certifications`
**File:** `app/(admin)/certifications/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the certifications management page for **Superhero CPR**. This page allows super admins to view all customer certifications, send expiry reminders, manage the automated reminder system, issue new certs, edit existing certs, and manage cert types — all in one place.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for sending reminder emails

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Super Admin only.

---

## Architecture

Hybrid — server fetches all data. Two tabs: Certifications and Cert Types. Tab switching is client-side.

---

## Data Fetching

```typescript
const [certifications, certTypes, remindersPaused] = await Promise.all([

  supabase
    .from('certifications')
    .select(`
      id, issued_at, expires_at, cert_number, notes, reminder_sent,
      profiles!customer_id ( id, first_name, last_name, email ),
      cert_types ( id, name, issuing_body ),
      class_sessions (
        starts_at,
        class_types ( name )
      )
    `)
    .order('expires_at', { ascending: true }),

  supabase
    .from('cert_types')
    .select('id, name, description, validity_months, issuing_body, active')
    .order('name'),

  supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'cert_reminders_paused')
    .single()
    .then(({ data }) => data?.value === 'true'),
])

// Split certifications
const now = new Date()
const expiringSoon = certifications.filter(c => {
  const days = Math.ceil((new Date(c.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return days >= 0 && days <= 90
})
const active = certifications.filter(c => {
  const days = Math.ceil((new Date(c.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return days > 90
})
const expired = certifications.filter(c => new Date(c.expires_at) < now)
```

---

## Page Header

- `<h1>`: `"Certifications"`
- **Pause Reminders toggle** — prominent, top right:
  - When active (reminders running): green toggle `"Reminders: Active"` — click to pause
  - When paused: red toggle `"Reminders: Paused"` — click to resume
  - Inline confirmation before pausing: `"Pause all automated cert expiry reminders?"` — [Cancel] [Pause]
  - No confirmation to resume — just click
  - Updates `system_settings` key `cert_reminders_paused`

---

## Tabs

Two tabs: **Certifications | Cert Types**

---

## Tab 1 — Certifications

### Filter Bar

- **Customer search** — text input, searches by name or email
- **Cert type** — dropdown of all cert types
- **Status** — pill buttons: All / Active / Expiring Soon / Expired
- **Date range** — issued between From / To
- **Reminder sent** — All / Sent / Not Sent
- Filters are client-side — all data already loaded

### Expiring Soon Section

Shown at top of list only when `expiringSoon.length > 0`.

**Section header:**
```
Amber banner: "[n] certifications expiring within 90 days"
[Send Reminders to All] button
```

**Send Reminders to All:**
- Triggers immediately — no preview
- Calls `/api/certifications/send-reminders`
- Sends reminder email to each customer whose cert is expiring and `reminder_sent = false`
- Already-reminded customers (where `reminder_sent = true`) are skipped
- After sending: banner updates to show `"Reminders sent to [n] customers."` in green
- If all already reminded: `"All expiring customers have already been reminded."`

**Each expiring cert row** — same as regular cert row but with amber left accent.

### Full Certifications List

Table layout on desktop, cards on mobile.

**Columns:**
- Customer name — link to `/admin/customers/[id]`
- Cert type
- Issued date
- Expiry status — same countdown logic from customer portal (green/amber/red)
- Cert number — if available, else `"—"`
- Reminder sent badge — green `"Sent"` or gray `"Not sent"`
- Manually issued badge — shown if `session_id = null`
- **Actions:**
  - `"Edit"` — opens slide-in edit panel
  - `"Delete"` — inline confirmation, no reason required

### Issue Cert Button

`"+ Issue Certification"` in section header area.

Slide-in panel:
- Customer — searchable dropdown
- Cert type — dropdown of active cert types
- Issue date — date picker, defaults to today
- Cert number (optional)
- Notes (optional)
- Expiry auto-calculated: issue date + validity_months

On submit: creates certification with `session_id = null` (manually issued).

### Edit Cert Panel

Slide-in panel pre-filled with cert data:
- Cert type — dropdown
- Issue date
- Expiry date — can be manually overridden (e.g. for corrections)
- Cert number
- Notes
- Reminder sent checkbox — can be manually reset to allow re-sending

On save: updates certification record.

### Delete Cert

Inline confirmation on the row:
```
"Delete this certification for [customer name]?"
[Cancel]  [Delete]
```

On confirm: deletes the record.

---

## Send Reminders API Route

**File:** `app/api/certifications/send-reminders/route.ts`

```typescript
export async function POST(request: Request) {
  const supabase = createClient()

  // Check if reminders are paused
  const { data: setting } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'cert_reminders_paused')
    .single()

  if (setting?.value === 'true') {
    return Response.json(
      { success: false, error: 'Reminders are currently paused.' },
      { status: 403 }
    )
  }

  const now = new Date()
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

  // Fetch expiring certs where reminder not yet sent
  const { data: certs } = await supabase
    .from('certifications')
    .select(`
      id, expires_at,
      profiles!customer_id ( first_name, email ),
      cert_types ( name )
    `)
    .eq('reminder_sent', false)
    .gte('expires_at', now.toISOString())
    .lte('expires_at', ninetyDaysFromNow.toISOString())

  if (!certs?.length) {
    return Response.json({ success: true, count: 0 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  let sentCount = 0

  for (const cert of certs) {
    const daysRemaining = Math.ceil(
      (new Date(cert.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )

    await resend.emails.send({
      from: 'Superhero CPR <noreply@superherocpr.com>',
      to: cert.profiles.email,
      subject: 'Your CPR Certification Expires Soon',
      html: `
        <h1>Your certification is expiring soon, ${cert.profiles.first_name}!</h1>
        <p>Your <strong>${cert.cert_types.name}</strong> certification expires in
        <strong>${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}</strong>.</p>
        <p>Book a renewal class today to stay certified.</p>
        <a href="https://superherocpr.com/book">Book a Renewal Class →</a>
        <p>— The Superhero CPR Team</p>
      `,
    })

    await supabase
      .from('certifications')
      .update({ reminder_sent: true })
      .eq('id', cert.id)

    sentCount++
  }

  return Response.json({ success: true, count: sentCount })
}
```

---

## Tab 2 — Cert Types

List of all cert types with add, edit, and deactivate options.

**Each cert type card shows:**
- Name — bold
- Issuing body
- Validity: `"Valid for [n] months"`
- Active/Inactive badge
- Count of certifications issued for this type — `"[n] certs issued"`
- **Actions:**
  - `"Edit"` — slide-in panel
  - `"Deactivate"` / `"Activate"` toggle — sets `active = false/true`
  - No delete — cert types are never deleted, only deactivated

**Add Cert Type button:**
`"+ Add Cert Type"` — slide-in panel:
- Name (required)
- Description (optional)
- Validity months (required) — number input
- Issuing body (optional)
- Active — boolean, default true

**Edit Cert Type panel:**
Same fields as add, pre-filled.

**Deactivate logic:**
Deactivating a cert type hides it from:
- The public booking page class type dropdown
- The issue cert customer-facing renewal prompts
- New cert issuance forms

Existing certifications of that type are NOT affected — they remain valid.

---

## Responsive

- Mobile: Cards, single column. Filter bar wraps.
- Desktop: Table for cert list, cards for cert types.

---

## Accessibility

- Pause/Resume toggle must have `aria-pressed` and `aria-label="Pause cert reminders"` / `"Resume cert reminders"`
- Tab buttons: `role="tab"`, `aria-selected`, `aria-controls`
- Reminder sent badge must convey meaning through text not color alone
- Send reminders result must use `role="status"` for screen reader announcement

---

## What NOT to Do

- Do not send reminders when `cert_reminders_paused = true` — always check before sending
- Do not delete cert types — only deactivate
- Do not filter server-side — all data loaded once, filter client-side
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to super admin
- [ ] Pause/resume toggle works and persists in system_settings
- [ ] Expiring soon section shown at top when certs within 90 days exist
- [ ] Send reminders fires immediately, skips already-reminded certs
- [ ] Reminder count shown after send
- [ ] Reminders blocked when paused — API returns 403
- [ ] All filters work client-side
- [ ] Issue cert slide-in panel works — expiry auto-calculated
- [ ] Edit cert panel pre-filled, saves correctly
- [ ] Delete cert requires inline confirmation
- [ ] Cert types tab shows all types with issue counts
- [ ] Add cert type panel works
- [ ] Edit cert type panel works
- [ ] Deactivate/activate toggle works
- [ ] Deactivated cert types hidden from new cert issuance
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
