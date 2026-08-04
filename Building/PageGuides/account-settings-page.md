# Account Settings Page Build Guide
**Route:** `/dashboard/settings`
**File:** `app/(public)/dashboard/settings/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/dashboard/settings` page for **Superhero CPR**. This page allows logged-in customers to update their personal information, change their email, change their password, and archive (soft-delete) their account.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for transactional emails

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching or update logic. Do not guess at table or column names.

This page is protected by the dashboard layout auth guard in `app/(public)/dashboard/layout.tsx`.

---

## Architecture

This page is a **client component** — it needs to:
- Track dirty (unsaved) state across all form fields
- Warn the user before navigating away with unsaved changes
- Save all changes without a page reload

The page itself (`page.tsx`) is a **thin server wrapper** that fetches the initial profile data and passes it to a client component. The client component owns all form state and save logic.

```
page.tsx (server) → fetches profile → passes to SettingsClient.tsx (client)
```

---

## Data Fetching — Server Side

```typescript
// page.tsx
const supabase = createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/book/signin?redirect=/dashboard/settings')

const { data: profile } = await supabase
  .from('profiles')
  .select('first_name, last_name, email, phone, address, city, state, zip')
  .eq('id', user.id)
  .single()

if (!profile) redirect('/book/signin')
```

Pass `profile` and `user.email` as props to `SettingsClient`.

---

## Client Component — `SettingsClient.tsx`

**Props:**
```typescript
interface SettingsClientProps {
  profile: {
    first_name: string
    last_name: string
    email: string
    phone: string | null
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
  }
  userId: string
}
```

### Form State

Use a single form state object tracking all fields:

```typescript
const [form, setForm] = useState({
  firstName: profile.first_name,
  lastName: profile.last_name,
  email: profile.email,
  phone: profile.phone ?? '',
  address: profile.address ?? '',
  city: profile.city ?? '',
  state: profile.state ?? '',
  zip: profile.zip ?? '',
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const [savedForm, setSavedForm] = useState({ ...form })
const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)
```

`isDirty` is `true` whenever the current form state differs from the last saved state. Use this to show the unsaved changes warning and enable/disable the save button.

### Unsaved Changes Warning

Use the `beforeunload` browser event to warn on page close/refresh:

```typescript
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (isDirty) {
      e.preventDefault()
      e.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
  return () => window.removeEventListener('beforeunload', handleBeforeUnload)
}, [isDirty])
```

For in-app navigation (Next.js router), show an inline banner at the top of the page when `isDirty`:

```
⚠ You have unsaved changes. Don't forget to save before leaving this page.
```

Style: `bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm`

This banner appears/disappears reactively as the user edits and saves. Do NOT use a modal or block navigation — just the banner reminder.

---

## Save Logic

One save button handles all sections. On click:

```typescript
async function handleSave() {
  setSaving(true)
  setError(null)
  setSuccess(null)

  try {
    // 1. Validate password fields if changed
    if (form.newPassword || form.confirmPassword || form.currentPassword) {
      if (!form.currentPassword) throw new Error('Please enter your current password to change it.')
      if (form.newPassword.length < 8) throw new Error('New password must be at least 8 characters.')
      if (form.newPassword !== form.confirmPassword) throw new Error('New passwords do not match.')
    }

    // 2. Update profile in DB
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        first_name: form.firstName,
        last_name: form.lastName,
        phone: form.phone || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        zip: form.zip || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (profileError) throw new Error('Failed to update profile.')

    // 3. Update email if changed
    if (form.email !== savedForm.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email: form.email })
      if (emailError) throw new Error('Failed to update email. ' + emailError.message)
      // Supabase sends a confirmation email to the new address automatically
    }

    // 4. Update password if changed
    if (form.newPassword && form.currentPassword) {
      // Re-authenticate first to verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: savedForm.email,
        password: form.currentPassword,
      })
      if (signInError) throw new Error('Current password is incorrect.')

      const { error: passwordError } = await supabase.auth.updateUser({
        password: form.newPassword,
      })
      if (passwordError) throw new Error('Failed to update password.')
    }

    // 5. Clear password fields, update saved state
    setForm(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }))
    setSavedForm({ ...form, currentPassword: '', newPassword: '', confirmPassword: '' })
    setSuccess('Your settings have been saved.')

  } catch (err) {
    setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
  } finally {
    setSaving(false)
  }
}
```

---

## Your Task

Build the complete `/dashboard/settings` page. Components live in `app/(public)/dashboard/settings/_components/`.

---

## Section 1 — Page Header

**Component:** `SettingsPageHeader.tsx`
**Type:** Server component (rendered in page.tsx, not inside SettingsClient)

**Content:**
- `<h1>`: `"Account Settings"`
- Subtext: `"Manage your personal information, email, and password."`

---

## Section 2 — Personal Info

Inside `SettingsClient.tsx` — not a separate component.

**Section heading:** `"Personal Information"` (`<h2>`)

**Fields:**
- First name (required)
- Last name (required)
- Phone (optional)
- Address (optional) — label: `"Address"`, note: `"Used for your certification records"`
- City (optional)
- State (optional) — US state dropdown
- Zip (optional)

All fields are controlled inputs bound to `form` state.

---

## Section 3 — Email

Inside `SettingsClient.tsx` — not a separate component.

**Section heading:** `"Email Address"` (`<h2>`)

**Field:**
- Email (required) — pre-populated from profile

**Note below the field:**
```
"If you change your email address, Supabase will send a confirmation link to your new address. Your email will not update until you click the confirmation link."
```

Style note as muted helper text below the input.

---

## Section 4 — Change Password

Inside `SettingsClient.tsx` — not a separate component.

**Section heading:** `"Change Password"` (`<h2>`)

**Fields:**
- Current password (required only if changing password)
- New password (min 8 characters)
- Confirm new password

**Behavior:**
- All three fields start empty
- If the user fills in any one of the three, all three are required on save
- If all three are empty on save, skip password update entirely — no error
- Password strength indicator on the new password field (same as booking flow — weak/good/strong)

---

## Section 5 — Save Button + Status

Inside `SettingsClient.tsx`.

**Layout:** Sticky bottom bar on mobile, inline at the bottom of the form on desktop.

**Save button:**
- Label: `"Save Changes"`
- Disabled when: `!isDirty || saving`
- While saving: label changes to `"Saving..."`, button disabled
- Style: `bg-red-600 hover:bg-red-700 text-white` when enabled, grayed out when disabled

**Success message** (shown after successful save, auto-dismisses after 5 seconds):
```
"✓ Your settings have been saved."
```
Style: `bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm`

**Error message** (shown when save fails):
```
"[error message from handleSave]"
```
Style: `bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm`

Both messages use `role="alert"` for accessibility.

---

## Section 6 — Danger Zone

Inside `SettingsClient.tsx`.

**Section heading:** `"Danger Zone"` (`<h2>`, red)

**Layout:** Red-bordered card at the bottom of the page.

**Content:**
- Heading inside card: `"Delete Account"`
- Body: `"Deleting your account will permanently remove your access to Superhero CPR. Your certification history will be preserved for our records but you will no longer be able to log in."`
- Button: `"Delete My Account"` — red outline button

**Confirmation flow:**
When the delete button is clicked, show an inline confirmation inside the card (do NOT use a browser `confirm()` dialog or a modal):

```
"Are you sure? This cannot be undone."
[Cancel]  [Yes, delete my account]
```

On confirming deletion — call the API route:

```typescript
const response = await fetch('/api/account/archive', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
})
const result = await response.json()
if (result.success) {
  await supabase.auth.signOut()
  router.push('/?accountDeleted=true')
}
```

---

## API Route — Archive Account

**File:** `app/api/account/archive/route.ts`

```typescript
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 })
  }

  // Fetch profile for email before archiving
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, email')
    .eq('id', user.id)
    .single()

  // Archive the profile
  const { error } = await supabase
    .from('profiles')
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) {
    return Response.json({ success: false, error: 'Failed to archive account' }, { status: 500 })
  }

  // Send account deletion confirmation email
  if (profile) {
    await resend.emails.send({
      from: 'Superhero CPR <noreply@superherocpr.com>',
      to: profile.email,
      subject: 'Your Superhero CPR account has been deleted',
      html: `
        <h1>Account Deleted</h1>
        <p>Hi ${profile.first_name},</p>
        <p>Your Superhero CPR account has been successfully deleted. You will no longer be able to log in.</p>
        <p>Your certification history has been preserved for our records.</p>
        <p>If you believe this was a mistake or wish to restore your account, please contact us at info@superherocpr.com or call (813) 966-3969.</p>
        <p>— The Superhero CPR Team</p>
      `,
    })
  }

  return Response.json({ success: true })
}
```

**Note:** This route archives the profile but does NOT call `supabase.auth.admin.deleteUser()` — the auth account is preserved so the data relationships remain intact. The `archived` flag is checked on login to prevent access. Add middleware to handle this:

In the dashboard layout auth guard, add:
```typescript
// After getting the user, check if their profile is archived
const { data: profile } = await supabase
  .from('profiles')
  .select('archived')
  .eq('id', user.id)
  .single()

if (profile?.archived) {
  await supabase.auth.signOut()
  redirect('/?accountDeleted=true')
}
```

---

## Home Page Archived Account Notice

When redirected to `/?accountDeleted=true` after archival, the home page should show a subtle notice. Add this to the home page server component:

```typescript
// In page.tsx for the home page
interface HomePageProps {
  searchParams: { accountDeleted?: string }
}
```

If `searchParams.accountDeleted === 'true'`, render a dismissible green banner at the top:
```
"Your account has been successfully deleted. Thank you for using Superhero CPR."
```

This banner requires a client component wrapper to handle the dismiss button. Build as `app/(public)/_components/AccountDeletedBanner.tsx` — a small `"use client"` component that reads the query param and shows/hides itself.

---

## Page Assembly

**File:** `app/(public)/dashboard/settings/page.tsx`

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SettingsPageHeader from './_components/SettingsPageHeader'
import SettingsClient from './_components/SettingsClient'

export const metadata = {
  title: 'Account Settings | Superhero CPR',
}

export default async function SettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/book/signin?redirect=/dashboard/settings')

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, email, phone, address, city, state, zip')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/book/signin')

  return (
    <main>
      <SettingsPageHeader />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <SettingsClient profile={profile} userId={user.id} />
      </div>
    </main>
  )
}
```

---

## Responsive Breakpoints

- Mobile: Single column. Save button sticky at bottom of viewport.
- Desktop (`lg`+): Max width `2xl` centered. Save button inline at bottom of form.

---

## Typography & Brand

- **Section dividers:** `border-t border-gray-200 pt-8 mt-8` between each section
- **Section headings:** `text-lg font-semibold text-gray-900 mb-4`
- **Danger zone heading:** `text-lg font-semibold text-red-600 mb-4`
- **Danger zone card:** `border border-red-200 rounded-lg p-5`
- **Helper text:** `text-xs text-gray-500 mt-1`
- **Save button disabled:** `bg-gray-300 text-gray-500 cursor-not-allowed`

---

## Accessibility Requirements

- All inputs must have associated `<label>` elements
- Required fields must have `required` and `aria-required="true"`
- Success and error messages must use `role="alert"`
- Unsaved changes banner must use `role="status"` (informational, not urgent)
- Delete confirmation inline UI must be keyboard navigable — Cancel and Confirm buttons are focusable
- Password fields must have `autocomplete` attributes:
  - Current password: `autocomplete="current-password"`
  - New password: `autocomplete="new-password"`
  - Confirm password: `autocomplete="new-password"`

---

## What NOT to Do

- Do not use `confirm()` or browser dialogs for delete confirmation — use inline UI
- Do not hard-delete the Supabase auth user — only set `archived: true` on the profile
- Do not skip the archived check in the dashboard layout — archived users must not access the portal
- Do not use `any` TypeScript types
- Do not save password fields to `savedForm` — always clear them after a successful save
- Do not block navigation with a modal for unsaved changes — use the banner reminder only
- Do not use inline styles — Tailwind only

---

## Definition of Done

The page is complete when:
- [ ] Unauthenticated users redirect to sign in
- [ ] Form pre-populated with current profile data on load
- [ ] `isDirty` correctly tracks changes — save button disabled when no changes
- [ ] Unsaved changes banner appears when form is dirty, disappears after save
- [ ] `beforeunload` warning fires when navigating away with unsaved changes
- [ ] Personal info saves correctly to `profiles` table
- [ ] Email change triggers Supabase confirmation email — profile email not updated until confirmed
- [ ] Password change validates current password before updating
- [ ] Password fields cleared after successful save
- [ ] All three password fields required if any one is filled
- [ ] Password fields skipped entirely if all three are empty
- [ ] Success message shown after save, auto-dismisses after 5 seconds
- [ ] Error message shown with specific error text on failure
- [ ] Delete account inline confirmation works — Cancel and Confirm buttons
- [ ] Archive API route sets `archived: true` and `archived_at` correctly
- [ ] Archival confirmation email sent via Resend
- [ ] After archival: user signed out and redirected to `/?accountDeleted=true`
- [ ] Dashboard layout blocks archived users and redirects them
- [ ] Home page shows account deleted banner when `?accountDeleted=true`
- [ ] Page fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export
