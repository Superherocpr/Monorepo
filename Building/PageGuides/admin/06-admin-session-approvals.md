# Admin Session Approvals Build Guide
**Route:** `/admin/sessions/approvals`
**File:** `app/(admin)/sessions/approvals/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the session approvals queue for **Superhero CPR**. This page shows all class sessions awaiting approval. Resubmitted sessions (previously rejected, now updated) appear at the top as they are behind schedule. Approve and reject actions are only available on the session detail page — this page is a prioritized review queue.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Manager and super admin only.

---

## Architecture

Fully server-rendered. No client components needed — this is a read-only queue with no interactive filtering.

---

## Data Fetching

```typescript
// Verify access
if (!['manager', 'super_admin'].includes(profile.role)) {
  redirect('/admin')
}

const { data: pendingSessions } = await supabase
  .from('class_sessions')
  .select(`
    id, starts_at, ends_at, approval_status,
    rejection_reason, created_at, updated_at,
    class_types ( name ),
    profiles ( first_name, last_name ),
    locations ( name, city, state )
  `)
  .eq('approval_status', 'pending_approval')
  .order('updated_at', { ascending: true })
```

**Split into two groups after fetching:**

```typescript
// Resubmissions: sessions that were previously rejected and resubmitted
// We detect these by checking if rejection_reason is not null
// (a session that was never rejected won't have a rejection_reason)
const resubmissions = pendingSessions.filter(s => s.rejection_reason !== null)
const newSubmissions = pendingSessions.filter(s => s.rejection_reason === null)

// Sort resubmissions: longest waiting first (ascending updated_at)
// Sort new submissions: longest waiting first
```

**Compute wait time:**
```typescript
function getWaitTime(submittedAt: string): string {
  const now = new Date()
  const submitted = new Date(submittedAt)
  const hours = Math.floor((now.getTime() - submitted.getTime()) / (1000 * 60 * 60))
  if (hours < 1) return 'Less than 1 hour'
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`
  const days = Math.floor(hours / 24)
  return `${days} day${days !== 1 ? 's' : ''}`
}
```

---

## Your Task

Build the complete approvals page. Components in `app/(admin)/sessions/approvals/_components/`.

---

## Page Header

- `<h1>`: `"Session Approvals"`
- Subtext: Total count — `"[n] session${n !== 1 ? 's' : ''} awaiting approval"`
- If zero pending: show empty state immediately (see below)

---

## Section 1 — Resubmissions

**Visibility:** Only render if `resubmissions.length > 0`

**Section header:**
```
Amber banner: "Resubmissions — These classes were previously rejected and have been updated. Review carefully."
```
Style: `bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4`
Icon: `AlertTriangle` from Lucide, `text-amber-600`

**Each resubmission card shows:**
- Class type name — bold (`<h3>`)
- Date and time — formatted
- Location — name, city, state
- Instructor name — `"Instructor: [first] [last]"`
- Wait time — `"Waiting [n] days"` in amber text
- Previous rejection reason — shown inline:
  ```
  "Previously rejected: [rejection_reason]"
  ```
  Style: `bg-red-50 border border-red-100 rounded px-3 py-2 text-sm text-red-700 mt-2`
- `"Review & Approve →"` button → `/admin/sessions/[id]`
  Style: outlined red button, right-aligned in card footer

---

## Section 2 — New Submissions

**Visibility:** Only render if `newSubmissions.length > 0`

**Section header:** `"New Submissions"` (`<h2>`)

**Each new submission card shows:**
- Class type name — bold (`<h3>`)
- Date and time — formatted
- Location — name, city, state
- Instructor name
- Wait time — `"Waiting [n] hours/days"` in muted text. If waiting more than 24 hours: amber text with `AlertTriangle` icon.
- `"Review & Approve →"` button → `/admin/sessions/[id]`

**No rejection reason shown** — these are fresh submissions.

---

## Empty State

When both `resubmissions.length === 0` and `newSubmissions.length === 0`:

- Icon: `CheckCircle2` from Lucide, `text-green-500`, size 48px
- Heading: `"All caught up!"`
- Body: `"No sessions are currently awaiting approval."`
- Link: `"View all sessions"` → `/admin/sessions`

---

## Card Design

Both resubmission and new submission cards share the same base style:
- White bg, `border border-gray-200 rounded-lg p-5`
- Resubmission cards: `border-l-4 border-l-amber-400` left accent
- New submission cards: `border-l-4 border-l-blue-400` left accent
- Card footer: right-aligned `"Review & Approve →"` button
- Consistent height within each section

---

## Page Assembly

```typescript
export default async function ApprovalsPage() {
  const supabase = createClient()
  // auth + access check
  // fetch + split sessions
  // compute wait times

  const totalPending = resubmissions.length + newSubmissions.length

  if (totalPending === 0) {
    return <ApprovalsEmptyState />
  }

  return (
    <main>
      <ApprovalsHeader count={totalPending} />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <ResubmissionsSection sessions={resubmissions} />
        <NewSubmissionsSection sessions={newSubmissions} />
      </div>
    </main>
  )
}
```

---

## Responsive

- Mobile: Single column cards, full width
- Desktop: Max width `4xl` centered, cards with comfortable padding

---

## Typography & Brand

- **Page title:** `text-2xl font-semibold text-gray-900`
- **Section headings:** `text-lg font-semibold text-gray-900`
- **Resubmission banner:** `bg-amber-50 border border-amber-200`
- **Resubmission card accent:** `border-l-4 border-l-amber-400`
- **New submission card accent:** `border-l-4 border-l-blue-400`
- **Wait time (urgent):** `text-amber-600 font-medium` with AlertTriangle icon
- **Wait time (normal):** `text-gray-500`
- **Rejection reason box:** `bg-red-50 border border-red-100 text-red-700`
- **Review button:** `border border-red-600 text-red-600 hover:bg-red-600 hover:text-white`

---

## Accessibility

- `<h1>` is the page title
- Section headings are `<h2>`
- Card class names are `<h3>`
- `"Review & Approve"` buttons must have descriptive `aria-label`:
  `aria-label="Review and approve [class name] on [date]"`
- AlertTriangle icons must have `aria-label="Warning"` or `aria-hidden="true"` if adjacent text conveys urgency
- Resubmission banner must use `role="alert"` so screen readers announce it

---

## What NOT to Do

- Do not put Approve or Reject buttons on this page — they belong on the session detail page only
- Do not combine resubmissions and new submissions in one list — keep them in separate sections
- Do not put resubmissions below new submissions — they are more urgent and go first
- Do not add bulk selection or bulk approve — one at a time only
- Do not use client components — fully server-rendered
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to manager and super admin
- [ ] Resubmissions section appears above new submissions
- [ ] Resubmissions section only renders when resubmissions exist
- [ ] New submissions section only renders when new submissions exist
- [ ] Each resubmission card shows previous rejection reason
- [ ] Wait time computed and displayed correctly
- [ ] Wait time shown in amber with warning icon when over 24 hours
- [ ] All `"Review & Approve"` buttons link to correct session detail page
- [ ] Empty state shown when no pending sessions
- [ ] No approve/reject buttons on this page
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
