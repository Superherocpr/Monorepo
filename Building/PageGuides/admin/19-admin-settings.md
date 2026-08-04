# Admin Settings Build Guide
**Route:** `/admin/settings`
**File:** `app/(admin)/settings/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the settings page for **Superhero CPR**. This page allows super admins to manage class types, preset grades, Zoho Mail connection, and their dark mode preference. Dark mode is stored in localStorage — it is device-specific and requires no database changes.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Super Admin only.

---

## Architecture

Hybrid — server fetches class types and preset grades. Client component handles all mutations and dark mode toggle (which must be client-side to access localStorage).

`page.tsx` — server wrapper, fetches data, passes to `SettingsClient.tsx`
`SettingsClient.tsx` — client component owning all state and mutations

---

## Data Fetching

```typescript
const [classTypes, presetGrades] = await Promise.all([

  supabase
    .from('class_types')
    .select('id, name, description, duration_minutes, max_capacity, price')
    .order('name'),

  supabase
    .from('preset_grades')
    .select('id, value, label')
    .order('value'),
])
```

---

## Page Header

- `<h1>`: `"Settings"`

---

## Sections

The page is divided into four sections separated by dividers. Each section has a heading and lives within the same scrollable page — no tabs needed.

---

## Section 1 — Appearance

**Heading:** `"Appearance"`

### Dark Mode Toggle

- Label: `"Dark Mode"`
- Description: `"Applies to this device only. Your preference is saved locally."`
- Toggle switch — on/off
- On toggle:
  - Reads/writes `localStorage.getItem('theme')` / `localStorage.setItem('theme', 'dark' | 'light')`
  - Adds/removes `class="dark"` on `document.documentElement`
  - Initializes on mount by reading localStorage

```typescript
// In SettingsClient.tsx
const [isDark, setIsDark] = useState(false)

useEffect(() => {
  const stored = localStorage.getItem('theme')
  const prefersDark = stored === 'dark'
  setIsDark(prefersDark)
  document.documentElement.classList.toggle('dark', prefersDark)
}, [])

function toggleDarkMode() {
  const next = !isDark
  setIsDark(next)
  localStorage.setItem('theme', next ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark', next)
}
```

**Note for the AI building this:** Dark mode Tailwind classes must be added throughout the admin layout using the `dark:` variant. This settings toggle is the control — the actual dark styling is the responsibility of the admin layout and component files. Add a comment: `// TODO: apply dark: variants to admin layout and components`.

---

## Section 2 — Class Types

**Heading:** `"Class Types"`
**Description:** `"Manage the CPR course offerings available for booking and invoicing."`

### Class Types List

Each class type card shows:
- Name — bold
- Description — muted, clamped to 2 lines
- Duration — `"[n] minutes"`
- Default capacity — `"Capacity: [n]"`
- Price — formatted as currency
- **Actions:**
  - `"Edit"` — opens edit slide-in panel
  - `"Deactivate"` / `"Activate"` toggle — one click, no confirmation

**Deactivated class types:**
- Shown with gray `"Inactive"` badge
- Hidden from public booking page and invoice class selection
- Existing sessions of that type are unaffected

**Add Class Type button:** `"+ Add Class Type"` — opens add slide-in panel

### Add / Edit Class Type Panel

**Fields:**
- Name (required)
- Description (optional)
- Duration in minutes (required) — number input
- Default max capacity (required) — number input
- Price (required) — currency input
- Active — boolean toggle, default true

On submit: insert or update `class_types` record. Close panel. Refresh list.

---

## Section 3 — Preset Grades

**Heading:** `"Preset Grades"`
**Description:** `"These grade values appear as quick-select buttons in the instructor grading tool."`

### Preset Grades List

Simple table:
| Value | Label | Actions |
|---|---|---|
| 70 | Fail | Edit / Delete |
| 85 | Pass | Edit / Delete |
| 100 | Distinction | Edit / Delete |

**Delete:** Only allowed if no `roster_records` use that grade value. If records exist, show: `"This grade is in use and cannot be deleted."` and hide the delete button.

**Edit:** Inline — click value or label to edit in place. Save on blur or Enter.

**Add Preset Grade button:** `"+ Add Grade"` — adds a new inline row with value and label inputs. Saves on confirm.

**Validation:**
- Value must be an integer between 0 and 100
- Value must be unique — no duplicates allowed
- Label is required

---

## Section 4 — Zoho Mail

**Heading:** `"Zoho Mail"`
**Description:** `"Used for replying to contact form submissions at /admin/contact. All other emails go through Resend."`

### Connection Status

**If connected:**
```
✓ Connected
Account: info@superherocpr.com
[Disconnect]
```

Green checkmark. Disconnect button is red outline. Clicking Disconnect clears Zoho tokens from `system_settings`.

**If not connected:**
```
Not connected
[Connect Zoho Mail →]
```

Clicking Connect initiates OAuth flow — redirects to `/api/contact/zoho-auth` which redirects to Zoho's authorization page.

**After OAuth callback (`/api/contact/zoho-callback`):**
- Tokens stored in `system_settings`
- Redirect back to `/admin/settings` with `?zoho=connected` param
- Page shows success banner: `"Zoho Mail connected successfully."`

---

## Instructor Payment Account — NOT on this page

The payment account connection for instructors lives in the **instructor's own profile area**, not here. This is intentional — it only affects the individual instructor and should feel personal to them, not like a system-wide setting.

Leave a note in the page for super admins:
```
"Instructors manage their payment account connections from their own profile settings."
```

Link: `"Go to my payment settings →"` — only shown if the current super admin is also an instructor (role check). Otherwise omit.

---

## API Routes

**`POST /api/settings/class-types`** — create class type
**`PATCH /api/settings/class-types/[id]`** — update class type
**`PATCH /api/settings/class-types/[id]/toggle-active`** — activate/deactivate
**`POST /api/settings/preset-grades`** — create preset grade
**`PATCH /api/settings/preset-grades/[id]`** — update preset grade
**`DELETE /api/settings/preset-grades/[id]`** — delete preset grade (only if unused)
**`DELETE /api/settings/zoho/disconnect`** — clears Zoho tokens from system_settings

---

## Dark Mode — Admin Layout Integration

The dark mode toggle sets `class="dark"` on `document.documentElement`. For this to work across the admin, the admin layout must also initialize the theme on load:

**File:** `app/(admin)/layout.tsx`

Add a script in the `<head>` to avoid flash of unstyled content:

```html
<script dangerouslySetInnerHTML={{
  __html: `
    (function() {
      var theme = localStorage.getItem('theme');
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      }
    })();
  `
}} />
```

This runs before React hydrates and prevents a flash of light mode on dark mode users.

---

## Responsive

- Mobile: Single column, sections stack vertically
- Desktop: Max width `3xl` centered

---

## Accessibility

- Dark mode toggle must be a proper `<button role="switch">` with `aria-checked`
- Class type and grade edit fields must have `<label>` elements
- Connection status must convey meaning through text not just color/icon
- Section headings must be `<h2>`

---

## What NOT to Do

- Do not store dark mode preference in the database — localStorage only
- Do not allow class types to be deleted — only deactivated
- Do not allow preset grades in use to be deleted
- Do not put instructor payment account settings on this page
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to super admin
- [ ] Dark mode toggle reads/writes localStorage correctly
- [ ] Dark mode initializes on mount without flash
- [ ] `class="dark"` added/removed on documentElement correctly
- [ ] Class types list shows all types with active/inactive badge
- [ ] Add class type panel works — all fields validate
- [ ] Edit class type panel pre-filled, saves correctly
- [ ] Activate/deactivate toggle works
- [ ] Preset grades list shows all grades in value order
- [ ] Inline edit works for value and label
- [ ] Add grade row works with validation
- [ ] Delete blocked if grade is in use — button hidden
- [ ] Delete works if grade is unused
- [ ] Duplicate grade values rejected
- [ ] Zoho connection status shown correctly
- [ ] Connect initiates OAuth flow
- [ ] Disconnect clears tokens from system_settings
- [ ] Success banner shown after OAuth callback
- [ ] Instructor payment account note shown — not a settings section
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
