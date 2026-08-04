# Admin Contact Submissions Build Guide
**Route:** `/admin/contact`
**File:** `app/(admin)/contact/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the contact submissions page for **Superhero CPR**. This page shows all contact form submissions and allows managers to reply directly through the system using the Zoho Mail API. Replies and inbound customer responses are displayed as a full thread. Resend is NOT used here — Zoho Mail handles all contact communication.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Zoho Mail API** — for sending replies and fetching email threads

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Manager and Super Admin only.

---

## Zoho Mail Integration

The business uses Zoho Mail for `info@superherocpr.com`. Our system connects via Zoho Mail API OAuth to send and read emails on behalf of that account.

**One-time setup:** A super admin connects the Zoho account from `/admin/settings`. OAuth token stored in a `system_settings` table (see Schema Addition below).

**Zoho Mail API base URL:** `https://mail.zoho.com/api/accounts/[accountId]/`

**Key endpoints used:**
- `GET /messages?mailbox=inbox&searchKey=[contact_email]` — fetch thread with a contact
- `POST /messages` — send a reply
- `GET /messages/[messageId]` — fetch a specific message with full body

**Authentication:** Bearer token from OAuth. Token refresh handled automatically — check expiry before each API call, refresh if needed.

---

## Schema Additions

### `system_settings`
> Key-value store for system-wide configuration including Zoho OAuth credentials.

```sql
create table system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
```

Keys used for Zoho:
- `zoho_access_token`
- `zoho_refresh_token`
- `zoho_account_id`
- `zoho_token_expires_at`

### `contact_replies`
> Replies sent by staff to contact form submissions. Stored locally for fast display.

```sql
create table contact_replies (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references contact_submissions(id),
  sent_by uuid not null references profiles(id),
  subject text not null,
  body text not null,
  zoho_message_id text,
  has_attachments boolean not null default false,
  created_at timestamptz not null default now()
);
```

---

## Architecture

Hybrid — server fetches submissions list. Submission detail + thread is loaded client-side when a submission is expanded (to avoid loading all Zoho threads upfront).

`page.tsx` — server, fetches submissions list with filters applied
`SubmissionsClient.tsx` — client, handles expansion, thread loading, reply form

---

## Data Fetching (Server)

```typescript
// Build filtered query
let query = supabase
  .from('contact_submissions')
  .select(`
    id, name, email, phone, inquiry_type,
    message, replied, created_at,
    contact_replies ( id, created_at )
  `)
  .order('replied', { ascending: true })        // unreplied first
  .order('created_at', { ascending: false })     // newest first within each group

// Apply filters
if (searchParams.type) query = query.eq('inquiry_type', searchParams.type)
if (searchParams.replied === 'true') query = query.eq('replied', true)
if (searchParams.replied === 'false') query = query.eq('replied', false)
if (searchParams.from) query = query.gte('created_at', searchParams.from)
if (searchParams.to) query = query.lte('created_at', searchParams.to + 'T23:59:59')

const { data: submissions } = await query
```

---

## Page Header

- `<h1>`: `"Contact Submissions"`
- Unanswered count badge: `"[n] unanswered"` in amber if > 0

---

## Filter Bar

Always visible above the list.

**Filters:**
- **Status** (pill buttons): All / Unanswered / Replied
- **Inquiry type** (dropdown): All / General Question / Group Booking / Corporate Training / Certification Renewal / Other
- **Date range**: From / To inputs
- **Clear filters** link when any filter active

Filter changes update URL params, trigger new server render.

---

## Submissions List

**Two visual sections:**

**Section 1 — Unanswered** (amber left accent `border-l-4 border-l-amber-400`):
- Shown first regardless of date
- Section label: `"Unanswered"` in amber

**Section 2 — Replied** (green left accent `border-l-4 border-l-green-400`):
- Shown below unanswered
- Section label: `"Replied"`

If all replied: no amber section. If none replied: no green section.

**Each submission row shows:**
- Name — bold
- Email — muted, `<a href="mailto:[email]">`
- Phone — muted (if provided)
- Inquiry type badge
- Message preview — first 120 characters, truncated with `"..."`
- Date submitted — relative time e.g. `"2 days ago"` with full date on hover
- Replied badge: green `"Replied"` or amber `"Awaiting Reply"`
- Reply count — `"[n] reply/replies"` if any replies sent
- **Expand button** — chevron icon, toggles the detail panel

---

## Expanded Submission Detail

When a submission is expanded, show below the row (accordion style):

### Original Message
Full message text, not truncated. Name, email, phone, inquiry type, date.

### Email Thread
**Loading state:** `"Loading conversation..."` while fetching Zoho thread.

Fetch thread via API route:
```typescript
// GET /api/contact/thread?email=[contact_email]
// Calls Zoho Mail API to fetch all messages with this contact
// Returns array of messages: { id, subject, body, from, date, isInbound }
```

Each message in thread displayed as a chat-style bubble:
- Staff replies: right-aligned, gray background
- Customer replies: left-aligned, white background with border
- Each shows: sender name, date, message body
- Attachments listed as downloadable links if present

**No thread yet:** `"No previous emails with this contact."` — just show the reply form.

### Reply Form

```
Subject: [pre-filled: "Re: [inquiry_type] inquiry from [name]"] — editable
Body: [textarea, required, min height 120px]
Attachments: [file input, multiple, accepts common file types]
[Send Reply] button
```

**On send:**
1. Call `/api/contact/reply` POST route
2. Zoho Mail API sends the email
3. Store reply in `contact_replies` table
4. Set `contact_submissions.replied = true`
5. Thread view refreshes to show new reply
6. Success: brief green confirmation inline

**Attachment handling:**
- Files uploaded to AWS S3 before sending
- S3 URLs passed to Zoho API as attachment references
- Max file size: 10MB per attachment
- Accepted types: PDF, DOC, DOCX, JPG, PNG

---

## API Routes

### `GET /api/contact/thread`
```typescript
// Fetches Zoho Mail thread for a given contact email
// Refreshes Zoho OAuth token if expired
// Returns: Message[]
```

### `POST /api/contact/reply`
```typescript
export async function POST(request: Request) {
  const { submissionId, subject, body, attachmentUrls } = await request.json()

  // 1. Get Zoho credentials from system_settings
  const accessToken = await getZohoToken() // handles refresh if expired
  const accountId = await getSetting('zoho_account_id')

  // 2. Get submission to get contact email
  const { data: submission } = await supabase
    .from('contact_submissions')
    .select('email, name')
    .eq('id', submissionId)
    .single()

  // 3. Send email via Zoho Mail API
  const zohoResponse = await fetch(
    `https://mail.zoho.com/api/accounts/${accountId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromAddress: 'info@superherocpr.com',
        toAddress: submission.email,
        subject,
        content: body,
        mailFormat: 'html',
        // attachments handled separately via Zoho attachment upload API
      }),
    }
  )

  if (!zohoResponse.ok) {
    return Response.json({ success: false, error: 'Failed to send email via Zoho.' }, { status: 500 })
  }

  const zohoData = await zohoResponse.json()

  // 4. Store reply locally
  const { data: staffMember } = await supabase.auth.getUser()
  await supabase.from('contact_replies').insert({
    submission_id: submissionId,
    sent_by: staffMember.user.id,
    subject,
    body,
    zoho_message_id: zohoData.data?.messageId ?? null,
    has_attachments: attachmentUrls.length > 0,
  })

  // 5. Mark submission as replied
  await supabase
    .from('contact_submissions')
    .update({ replied: true })
    .eq('id', submissionId)

  return Response.json({ success: true })
}
```

### `GET /api/contact/zoho-auth`
Initiates Zoho OAuth flow. Redirects to Zoho authorization page. Called from `/admin/settings`.

### `GET /api/contact/zoho-callback`
OAuth callback. Stores access token, refresh token, account ID in `system_settings`.

---

## Zoho Token Refresh Utility

```typescript
// lib/zoho.ts
export async function getZohoToken(): Promise<string> {
  const expiresAt = await getSetting('zoho_token_expires_at')
  const isExpired = new Date(expiresAt) <= new Date()

  if (!isExpired) {
    return getSetting('zoho_access_token')
  }

  // Refresh token
  const refreshToken = await getSetting('zoho_refresh_token')
  const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
    }),
  })

  const data = await response.json()

  // Update stored tokens
  await updateSetting('zoho_access_token', data.access_token)
  await updateSetting('zoho_token_expires_at',
    new Date(Date.now() + data.expires_in * 1000).toISOString()
  )

  return data.access_token
}
```

---

## Environment Variables

Add to `.env.local`:
```
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REDIRECT_URI=https://superherocpr.com/api/contact/zoho-callback
```

---

## Empty State

No submissions:
- Icon: `Mail` from Lucide
- Text: `"No contact submissions yet."`

No submissions matching filters:
- Text: `"No submissions match your filters."`
- Clear filters link

---

## Responsive

- Mobile: Cards, full width. Reply form full width below thread.
- Desktop: List with comfortable row spacing. Thread expands inline below each row.

---

## What NOT to Do

- Do not use Resend for contact replies — Zoho Mail API only
- Do not load all Zoho threads on page load — fetch per submission when expanded
- Do not allow reply without Zoho being connected — show setup prompt if not connected
- Do not mark replied manually without sending — replied status set automatically on send
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to manager and super admin
- [ ] Unanswered submissions appear above replied ones
- [ ] All filters work with URL params
- [ ] Submission rows show correct info and replied badge
- [ ] Expand/collapse works per submission
- [ ] Zoho thread loads when submission expanded
- [ ] Staff replies and customer replies visually distinct in thread
- [ ] Reply form pre-fills subject correctly
- [ ] Attachments upload to S3 before sending
- [ ] Reply sent via Zoho Mail API
- [ ] Reply stored in contact_replies table
- [ ] Submission marked replied after send
- [ ] Thread refreshes to show new reply after send
- [ ] Zoho token refresh handled automatically
- [ ] Setup prompt shown if Zoho not connected
- [ ] Empty states render correctly
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
