# My Certifications Page Build Guide
**Route:** `/dashboard/certifications`
**File:** `app/(public)/dashboard/certifications/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/dashboard/certifications` page for **Superhero CPR**. This page shows a logged-in customer all of their earned CPR certifications — active and expired. It is fully server-rendered and read-only. Certificate download/printing is handled by a separate tool and is not part of this page.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

This page is protected by the dashboard layout auth guard in `app/(public)/dashboard/layout.tsx`. No additional auth check needed beyond confirming the user exists.

---

## Architecture

Fully server-rendered. No client components. All data fetched in `page.tsx` before render.

---

## Data Fetching

```typescript
const supabase = createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/book/signin?redirect=/dashboard/certifications')

const { data: certifications } = await supabase
  .from('certifications')
  .select(`
    id,
    issued_at,
    expires_at,
    cert_number,
    notes,
    cert_types (
      name,
      issuing_body,
      validity_months
    ),
    class_sessions (
      starts_at,
      class_types ( name )
    )
  `)
  .eq('customer_id', user.id)
  .order('expires_at', { ascending: true })
```

**Split into two groups after fetching:**
```typescript
const now = new Date()

const active = (certifications ?? []).filter(c => new Date(c.expires_at) >= now)
const expired = (certifications ?? []).filter(c => new Date(c.expires_at) < now)

// Sort active: soonest expiring first (most urgent at top)
active.sort((a, b) =>
  new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()
)

// Sort expired: most recently expired first
expired.sort((a, b) =>
  new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime()
)
```

**Define TypeScript interface in `types/certifications.ts`:**
```typescript
export interface CertificationRecord {
  id: string
  issued_at: string
  expires_at: string
  cert_number: string | null
  notes: string | null
  cert_types: {
    name: string
    issuing_body: string | null
    validity_months: number
  }
  class_sessions: {
    starts_at: string
    class_types: { name: string }
  } | null
}
```

---

## Cert Status Utility

Reuse the same `getCertStatus` function from the dashboard. Define it once in `lib/cert-utils.ts` and import it in both the dashboard and this page:

```typescript
// lib/cert-utils.ts

export function getCertStatus(expiresAt: string): {
  label: string
  color: 'green' | 'amber' | 'red'
} {
  const now = new Date()
  const expiry = new Date(expiresAt)
  const daysRemaining = Math.ceil(
    (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (daysRemaining < 0) {
    return { label: 'Expired', color: 'red' }
  }
  if (daysRemaining <= 90) {
    return {
      label: `Expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`,
      color: 'amber',
    }
  }
  return {
    label: `Expires ${new Date(expiresAt).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })}`,
    color: 'green',
  }
}

export function getClassSlug(className: string): string {
  return className.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}
```

**Important:** If the dashboard currently defines `getCertStatus` inline, refactor it to import from `lib/cert-utils.ts` instead. Do not duplicate the function.

---

## Your Task

Build the complete `/dashboard/certifications` page. Components live in `app/(public)/dashboard/certifications/_components/`.

---

## Section 1 — Page Header

**Component:** `CertificationsPageHeader.tsx`
**Type:** Server component

**Content — hardcoded:**
- `<h1>`: `"My Certifications"`
- Subtext: `"Your American Heart Association certifications earned through Superhero CPR."`

---

## Section 2 — Active Certifications

**Component:** `ActiveCertificationsList.tsx`
**Type:** Server component

**Props:**
```typescript
interface ActiveCertificationsListProps {
  certifications: CertificationRecord[]
}
```

**Visibility:** If `certifications.length === 0`, render an empty state:
- Icon: `Award` from Lucide React, `text-gray-300`, size 48px
- Heading: `"No active certifications"`
- Body: `"Complete a CPR class to earn your first AHA certification."`
- CTA button: `"Book a Class"` → `/book`

**Section heading:** `"Active Certifications"` (`<h2>`)

**Each certification card shows:**

- **Header row:**
  - Cert type name — bold, large (`<h3>`)
  - Status badge — using `getCertStatus()`:
    - Green: `bg-green-100 text-green-800`
    - Amber: `bg-amber-100 text-amber-800` + `AlertTriangle` icon (16px)
    - Red: `bg-red-100 text-red-800` + `XCircle` icon (16px)

- **Details grid** (2 columns on desktop, 1 on mobile):
  - Issuing body: `cert_types.issuing_body ?? "American Heart Association"`
  - Issued: formatted date e.g. `"April 1, 2024"`
  - Expires: formatted date e.g. `"April 1, 2026"`
  - Cert number: shown if not null, otherwise `"—"`
  - Earned in class: if `class_sessions` is not null — `"[class_types.name] on [formatted date]"`. If null (manually issued) — `"Manually issued"`

- **Footer row — Book Renewal button:**
  Always shown on active cert cards. Links to `/book?class=[slug]` where slug is derived from the cert type name:
  ```typescript
  const slug = getClassSlug(cert.cert_types.name)
  // "BLS" → "bls", "CPR+AED" → "cpr-aed"
  ```
  Button label: `"Book Renewal Class"`
  Style: outlined red button, right-aligned in the card footer
  
  This button appears on ALL active certs — not just expiring ones. A customer may want to renew early.

**Card design:** White bg, `border border-gray-200`, `rounded-lg`, `p-5`. Amber-expiring cards get a left accent border: `border-l-4 border-l-amber-400`. Expired cards (should not appear in active list but guard anyway) get `border-l-4 border-l-red-400`.

---

## Section 3 — Renewal CTA Banner

**Component:** `RenewalCtaBanner.tsx`
**Type:** Server component

**Props:**
```typescript
interface RenewalCtaBannerProps {
  hasExpiringSoon: boolean  // true if any active cert expires within 90 days
}
```

**Visibility:** Only render if `hasExpiringSoon === true`.

**Layout:** Full-width amber banner between active and expired sections.

**Content:**
- Icon: `AlertTriangle` from Lucide, amber
- Heading: `"You have certifications expiring soon"`
- Body: `"Don't let your AHA certification lapse. Book a renewal class today to stay current."`
- CTA button: `"Book a Renewal Class"` → `/book`

**Style:** `bg-amber-50 border border-amber-200 rounded-lg p-5`

---

## Section 4 — Expired Certifications

**Component:** `ExpiredCertificationsList.tsx`
**Type:** Server component

**Props:**
```typescript
interface ExpiredCertificationsListProps {
  certifications: CertificationRecord[]
}
```

**Visibility:** If `certifications.length === 0`, return `null`.

**Layout:** Collapsible `<details>` / `<summary>` — collapsed by default. Same pattern as cancelled bookings.

```html
<details>
  <summary>Expired Certifications ({count})</summary>
  <!-- list here -->
</details>
```

Style the summary identically to the cancelled bookings section in the bookings page — consistent UI patterns across the portal.

**Each expired cert shows (compact list, not full cards):**
- Cert type name — bold
- Issuing body — muted
- Expired date — `"Expired [date]"` in red text
- `"Book Renewal"` text link → `/book?class=[slug]`

---

## Page Assembly

**File:** `app/(public)/dashboard/certifications/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CertificationsPageHeader from './_components/CertificationsPageHeader'
import ActiveCertificationsList from './_components/ActiveCertificationsList'
import RenewalCtaBanner from './_components/RenewalCtaBanner'
import ExpiredCertificationsList from './_components/ExpiredCertificationsList'
import type { CertificationRecord } from '@/types/certifications'

export const metadata = {
  title: 'My Certifications | Superhero CPR',
}

export default async function CertificationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/book/signin?redirect=/dashboard/certifications')

  const { data: certifications } = await supabase
    .from('certifications')
    .select(`
      id, issued_at, expires_at, cert_number, notes,
      cert_types ( name, issuing_body, validity_months ),
      class_sessions (
        starts_at,
        class_types ( name )
      )
    `)
    .eq('customer_id', user.id)
    .order('expires_at', { ascending: true })

  const now = new Date()
  const allCerts = (certifications ?? []) as CertificationRecord[]

  const active = allCerts
    .filter(c => new Date(c.expires_at) >= now)
    .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())

  const expired = allCerts
    .filter(c => new Date(c.expires_at) < now)
    .sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime())

  const hasExpiringSoon = active.some(c => {
    const days = Math.ceil(
      (new Date(c.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )
    return days <= 90
  })

  return (
    <main>
      <CertificationsPageHeader />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <ActiveCertificationsList certifications={active} />
        <RenewalCtaBanner hasExpiringSoon={hasExpiringSoon} />
        <ExpiredCertificationsList certifications={expired} />
      </div>
    </main>
  )
}
```

---

## Shared Utility Refactor

**Important:** The `getCertStatus` function must be defined ONCE in `lib/cert-utils.ts` and imported in:
- `app/(public)/dashboard/_components/CertificationsWidget.tsx`
- `app/(public)/dashboard/certifications/_components/ActiveCertificationsList.tsx`
- `app/(public)/dashboard/certifications/_components/ExpiredCertificationsList.tsx`

Do not copy-paste the function. If it already exists inline in the dashboard widget, move it to `lib/cert-utils.ts` and update the import.

---

## Responsive Breakpoints

- Mobile: Single column. Cert detail grid is 1 column.
- Desktop (`lg`+): Max width `4xl` centered. Cert detail grid is 2 columns.

---

## Typography & Brand

- **Active cert cards:** White bg, `border border-gray-200 rounded-lg p-5`
- **Expiring cert cards:** Add `border-l-4 border-l-amber-400` left accent
- **Card header:** Class name as `<h3>` — `text-lg font-semibold`
- **Detail labels:** `text-sm text-gray-500`
- **Detail values:** `text-sm text-gray-900 font-medium`
- **Book Renewal button:** `border border-red-600 text-red-600 hover:bg-red-600 hover:text-white text-sm px-4 py-2 rounded-md`
- **Renewal CTA banner:** `bg-amber-50 border border-amber-200 rounded-lg p-5`

---

## Accessibility Requirements

- `<h1>` is the page title only
- Section headings are `<h2>`
- Cert type names inside cards are `<h3>`
- Status badges must include text label — never color alone
- Warning icons must have `aria-label="Warning"` or `aria-hidden="true"` if the badge text already conveys the meaning
- `<details>` / `<summary>` for expired certs is natively accessible
- `"Book Renewal Class"` buttons must have descriptive `aria-label`: `aria-label="Book renewal class for [cert type name]"`

---

## What NOT to Do

- Do not add cert download or print functionality — that is a separate tool
- Do not define `getCertStatus` inline — import from `lib/cert-utils.ts`
- Do not show expired certs in the active section — filter strictly by `expires_at >= now`
- Do not use client components — fully server-rendered
- Do not use `any` TypeScript types
- Do not show notes field to customers — it is an admin-only field
- Do not use inline styles — Tailwind only
- Do not put all sections in one file

---

## Definition of Done

The page is complete when:
- [ ] Unauthenticated users redirect to sign in
- [ ] Active certifications render with all fields — cert type, issuing body, dates, cert number, class earned in
- [ ] Status badge shows correct color and countdown text using `getCertStatus()`
- [ ] `getCertStatus` imported from `lib/cert-utils.ts` — not defined inline
- [ ] Book Renewal button on every active cert links to correct `/book?class=[slug]`
- [ ] Empty state renders with Book a Class CTA when no active certs
- [ ] Amber left border accent on expiring certs (within 90 days)
- [ ] Renewal CTA banner shown only when at least one cert expires within 90 days
- [ ] Expired certs section collapses with native details/summary
- [ ] Expired section hidden when no expired certs
- [ ] Each expired cert has a Book Renewal text link
- [ ] Page fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export
