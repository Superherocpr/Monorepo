# Admin Staff Management Build Guide
**Route:** `/admin/staff`
**File:** `app/(admin)/staff/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the staff management page for **Superhero CPR**. Super admins manage all staff accounts from this page — inviting new staff, changing roles, and deactivating accounts. All staff members are always visible including deactivated ones. The owner's email is hardcoded and protected — their super admin role cannot be changed by anyone.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **Resend** — for staff invitation emails

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Super Admin only.

---

## Owner Protection

The business owner's email is hardcoded as a constant:

```typescript
// lib/constants.ts
export const OWNER_EMAIL = 'owner@superherocpr.com' // replace with actual owner email
```

Any staff member whose profile email matches `OWNER_EMAIL`:
- Cannot have their role changed by anyone
- Cannot be deactivated
- All role change and deactivate buttons are hidden for their row
- This is enforced both in the UI and in the API routes

---

## Schema Addition

Staff deactivation uses a new `deactivated` field on `profiles`. Add:

```sql
alter table profiles
  add column deactivated boolean not null default false,
  add column deactivated_at timestamptz;
```

When `deactivated = true`:
- Staff member cannot log in
- Their data (sessions, invoices, grading records) is fully preserved
- They remain visible in the staff list

---

## Data Fetching

```typescript
const { data: staffMembers } = await supabase
  .from('profiles')
  .select('id, first_name, last_name, email, role, deactivated, deactivated_at, created_at')
  .in('role', ['instructor', 'manager', 'super_admin', 'inspector'])
  .order('role')
  .order('last_name')
```

All staff returned — active and deactivated. No filtering by default.

---

## Page Header

- `<h1>`: `"Staff Management"`
- `"+ Invite Staff Member"` button — opens invite panel

---

## Filter Bar

**Status filter (pill buttons):** All / Active / Deactivated
**Role filter (pill buttons):** All / Instructor / Manager / Super Admin / Inspector

Filters are client-side — all data already loaded.

---

## Staff List

Table layout on desktop, cards on mobile.

**Each staff row shows:**
- Full name — bold
- Email — muted
- Role badge:
  - `instructor` → blue `"Instructor"`
  - `manager` → purple `"Manager"`
  - `super_admin` → red `"Super Admin"`
  - `inspector` → teal `"Inspector"`
- Status badge — green `"Active"` or gray `"Deactivated"`
- Join date — `"Since [month year]"`
- Deactivated date — shown if deactivated: `"Deactivated [date]"`
- **Actions** (hidden for owner):
  - `"Change Role"` — dropdown to select new role, confirm button
  - `"Deactivate"` / `"Reactivate"` — toggle

---

## Change Role

Clicking `"Change Role"` opens an inline dropdown on that row:

```
New role: [dropdown — Instructor / Manager / Super Admin / Inspector]
[Cancel]  [Save Role]
```

On save:
- Updates `profiles.role`
- If changing to a role that requires payment account (instructor) and none exists: show a note `"Remind this staff member to connect a payment account at /admin/settings/payment"`

**Owner protection:** If target staff member's email matches `OWNER_EMAIL`, this action is blocked server-side with a 403. The button is also hidden in the UI.

**Self-demotion prevention:** A super admin cannot change their own role. The change role button is hidden on their own row.

---

## Deactivate / Reactivate

**Deactivate** — opens inline confirmation:
```
"Deactivate [name]? They will no longer be able to log in."
[Cancel]  [Deactivate]
```

On confirm:
- Sets `profiles.deactivated = true`, `profiles.deactivated_at = now()`
- Supabase auth: calls `supabase.auth.admin.updateUser(id, { ban_duration: 'none' })` to block login

**Reactivate** — one click, no confirmation:
- Sets `profiles.deactivated = false`, `profiles.deactivated_at = null`
- Calls `supabase.auth.admin.updateUser(id, { ban_duration: '0' })` to restore login

**Owner protection:** Deactivate button hidden and blocked server-side for owner email.

---

## Invite Staff Member

Slide-in panel from the right.

**Fields:**
- First name (required)
- Last name (required)
- Email (required)
- Role (required) — dropdown: Instructor / Manager / Inspector
  - Super Admin cannot be selected from this form — must be manually promoted after account creation
- Personal message (optional) — included in the invite email

**On submit — `POST /api/staff/invite`:**

```typescript
export async function POST(request: Request) {
  const supabase = createClient()
  const { firstName, lastName, email, role, personalMessage } = await request.json()

  // 1. Check for duplicate email
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return Response.json(
      { success: false, error: 'An account with this email already exists.' },
      { status: 409 }
    )
  }

  // 2. Create Supabase auth user
  const tempPassword = crypto.randomUUID()
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return Response.json({ success: false, error: 'Failed to create account.' }, { status: 500 })
  }

  // 3. Insert profile with assigned role
  await supabase.from('profiles').insert({
    id: authData.user.id,
    first_name: firstName,
    last_name: lastName,
    email,
    role,
  })

  // 4. Generate password setup link
  const { data: linkData } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
  })

  // 5. Send invitation email via Resend
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'Superhero CPR <noreply@superherocpr.com>',
    to: email,
    subject: "You've been invited to join Superhero CPR",
    html: `
      <h1>Welcome to the Superhero CPR team, ${firstName}!</h1>
      ${personalMessage ? `<p>${personalMessage}</p>` : ''}
      <p>Your account has been created with the role of <strong>${role}</strong>.</p>
      <p>Click the link below to set your password and activate your account.</p>
      <p><a href="${linkData.properties.action_link}">Set My Password →</a></p>
      <p>This link expires in 24 hours.</p>
      ${role === 'instructor' ? `
        <p><strong>Important:</strong> Once you log in, you'll need to connect a payment account
        before you can send invoices. Visit Admin → Settings → Payment to get set up.</p>
      ` : ''}
      <p>— The Superhero CPR Team</p>
    `,
  })

  return Response.json({ success: true })
}
```

**After successful invite:**
- Close slide-in panel
- Show success toast: `"Invitation sent to [email]."`
- Refresh staff list

---

## Onboarding Flow Placeholder

When an instructor logs in for the first time (no payment account connected), they should be guided through an onboarding checklist:

1. Set profile info (phone, address)
2. Connect payment account at `/admin/settings/payment`
3. Upload bio photo (if applicable)

**This onboarding flow is not yet built.** Leave a `// TODO: instructor onboarding flow` comment in the invite email template and in the instructor dashboard layout where the check for payment account would redirect new instructors.

The invite email currently includes a plain-text reminder for instructors to connect their payment account. This is the interim solution until onboarding is built.

---

## Empty State

If no staff members:
- Icon: `Users` from Lucide
- Text: `"No staff members yet."`
- `"Invite your first staff member"` button

---

## Responsive

- Mobile: Card layout per staff member
- Desktop: Table layout

---

## Accessibility

- Role dropdown must have `aria-label="Change role for [name]"`
- Deactivate/reactivate buttons must have `aria-label="Deactivate [name]"` / `"Reactivate [name]"`
- Filter pills must use `aria-pressed`
- Invite panel must trap focus when open

---

## What NOT to Do

- Do not hide deactivated staff — all staff always visible
- Do not allow role changes for the owner email — block in UI and API
- Do not allow self-demotion — hide change role button on own row
- Do not allow Super Admin to be selected in the invite form — must be promoted manually after
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to super admin
- [ ] All staff shown — active and deactivated
- [ ] Status and role filters work client-side
- [ ] Active and deactivated badges shown on every row
- [ ] Owner row has no action buttons — protected in UI and API
- [ ] Change role dropdown works — saves correctly
- [ ] Self-demotion prevented — change role hidden on own row
- [ ] Super Admin not available in invite form role dropdown
- [ ] Deactivate requires inline confirmation
- [ ] Reactivate is one click — no confirmation
- [ ] Deactivation blocks Supabase auth login
- [ ] Reactivation restores Supabase auth login
- [ ] Invite panel opens as slide-in
- [ ] Invite email sent with role-specific instructions for instructors
- [ ] Onboarding TODO placeholder left in code comments
- [ ] Duplicate email check on invite works
- [ ] Staff list refreshes after invite
- [ ] Empty state renders correctly
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
