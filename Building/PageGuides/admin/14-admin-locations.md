# Admin Locations Build Guide
**Route:** `/admin/locations`
**File:** `app/(admin)/locations/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the locations management page for **Superhero CPR**. This page allows managers and super admins to manage saved class venues. Only one location can be marked as the home base at a time. Locations with linked sessions cannot be deleted.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Manager and Super Admin only.

---

## Architecture

Hybrid — server fetches all locations with session counts. Client component handles add, edit, delete, and home base toggle actions.

---

## Data Fetching

```typescript
const { data: locations } = await supabase
  .from('locations')
  .select(`
    id, name, address, city, state, zip,
    notes, is_home_base, created_at,
    class_sessions ( id )
  `)
  .order('is_home_base', { ascending: false }) // home base first
  .order('name', { ascending: true })

const locationsWithCount = (locations ?? []).map(loc => ({
  ...loc,
  sessionCount: loc.class_sessions.length,
}))
```

---

## Page Header

- `<h1>`: `"Locations"`
- `"+ Add Location"` button — opens slide-in panel

---

## Locations List

Card grid — 1 col mobile, 2 col desktop.

**Each location card shows:**
- Location name — bold (`<h2>`)
- Home base badge — green `"Home Base"` if `is_home_base = true`
- Full address block:
  ```
  [address]
  [city], [state] [zip]
  ```
- Notes — muted text, shown if not null
- Session count — `"Used in [n] session${n !== 1 ? 's' : ''}"` — muted small text
- **Actions row:**
  - `"Edit"` button — opens edit mode inline on the card
  - `"Set as Home Base"` button — shown if `is_home_base = false`. One click, no confirmation.
  - `"Delete"` button — shown only if `sessionCount === 0`. Red outline.

---

## Home Base Logic

Only one location can have `is_home_base = true` at a time.

When `"Set as Home Base"` is clicked:
1. Set all locations `is_home_base = false`
2. Set selected location `is_home_base = true`
3. Refresh list

The current home base does not show a `"Set as Home Base"` button — it already is the home base. Show a muted `"Current home base"` note instead.

---

## Inline Edit Mode

When `"Edit"` is clicked on a card, the card transforms into an editable form in place:

**Editable fields:**
- Name (required)
- Address (required)
- City (required)
- State (required) — US state dropdown
- Zip (required)
- Notes (optional)

**Actions:**
- `"Save"` button — validates and saves
- `"Cancel"` button — reverts to display mode, no changes saved

**Validation:**
- All required fields must be filled
- Inline error messages per field

---

## Add Location Panel

Slide-in panel from the right.

**Fields:** Same as edit — name, address, city, state, zip, notes.

**On submit:**
- Insert new location record
- Close panel
- Refresh list — new location appears
- Success toast: `"Location added."`

---

## Delete Logic

Delete button only shown when `sessionCount === 0`.

If the manager somehow tries to delete a location with sessions (defensive check):
- Server returns error
- Show: `"This location is used in [n] sessions and cannot be deleted."`

On delete — inline confirmation on the card:
```
"Delete [location name]?"
[Cancel]  [Delete]
```

No reason required for deletion.

---

## Empty State

If no locations exist:
- Icon: `MapPin` from Lucide
- Text: `"No locations saved yet."`
- `"Add your first location"` button

---

## API Routes

**`POST /api/locations`** — create new location
**`PATCH /api/locations/[id]`** — update location
**`DELETE /api/locations/[id]`** — delete location (only if no sessions)
**`PATCH /api/locations/[id]/set-home-base`** — sets as home base, clears others

---

## Responsive

- Mobile: Single column cards
- Desktop: Two column card grid

---

## Accessibility

- Edit mode inputs must have `<label>` elements
- Delete confirmation must be keyboard navigable
- Home base badge must have descriptive text — not color alone
- `"Set as Home Base"` button must have `aria-label="Set [location name] as home base"`

---

## What NOT to Do

- Do not allow deletion of locations with linked sessions
- Do not allow more than one home base — always clear others when setting new one
- Do not use separate pages for add/edit — inline and slide-in only
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to manager and super admin
- [ ] Locations load with session counts
- [ ] Home base location appears first with badge
- [ ] Edit mode works inline on each card
- [ ] Add location slide-in panel works
- [ ] Home base toggle clears all others and sets selected
- [ ] Delete button hidden when session count > 0
- [ ] Delete requires inline confirmation
- [ ] Defensive server check prevents deleting locations with sessions
- [ ] Empty state renders correctly
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
