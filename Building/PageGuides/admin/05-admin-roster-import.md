# Admin Roster Import Build Guide
**Route:** `/admin/sessions/[id]/roster`
**File:** `app/(admin)/sessions/[id]/roster/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the roster import tool for **Superhero CPR**. This tool allows managers and super admins to import a spreadsheet of students into a class session. The tool supports CSV and Excel files, auto-detects column names, allows inline editing of errors before import, and skips duplicate students.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)
- **xlsx** (SheetJS) — for parsing Excel files client-side

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Manager and super admin only. Instructors do not have access to this tool.

Install if not present:
```bash
npm install xlsx
```

---

## Architecture

This is a **client component** — all file parsing, column mapping, inline editing, and preview happens in the browser before anything is sent to the server.

`page.tsx` — thin server wrapper, verifies access, fetches session info and existing roster records (for duplicate detection), passes to `RosterImportClient.tsx`

`RosterImportClient.tsx` — client component owning the entire import flow

---

## Data Fetching (Server)

```typescript
// Verify access — manager/super admin only
if (!['manager', 'super_admin'].includes(profile.role)) {
  redirect('/admin/sessions/' + params.id)
}

const { data: session } = await supabase
  .from('class_sessions')
  .select('id, starts_at, max_capacity, class_types(name), locations(name)')
  .eq('id', params.id)
  .single()

// Fetch existing roster emails for duplicate detection
const { data: existing } = await supabase
  .from('roster_records')
  .select('email')
  .eq('session_id', params.id)

const existingEmails = new Set((existing ?? []).map(r => r.email?.toLowerCase()))

// Check for pending customer roster upload
const { data: pendingUpload } = await supabase
  .from('roster_uploads')
  .select('id, file_url, original_filename, submitted_by_name, created_at')
  .eq('session_id', params.id)
  .eq('imported', false)
  .order('created_at', { ascending: false })
  .limit(1)
  .single()
```

---

## Import Flow — 4 Steps

### Step 1 — Upload

**File input area:**
- Drag and drop zone OR click to browse
- Accepts: `.csv`, `.xlsx`, `.xls`
- File parsed immediately client-side — no server upload yet
- Show filename and row count after parsing

**Customer roster banner:**
If `pendingUpload` exists, show at the top:
```
"A roster has been submitted by [submitted_by_name ?? 'a customer'] for this class.
Original file: [original_filename]"
[Load Customer Roster] button
```
Clicking Load downloads the file from `file_url` and pre-loads it into the import flow.

**Parsing logic:**
```typescript
// CSV: use built-in FileReader + manual CSV parse
// Excel: use SheetJS xlsx.read()

import * as XLSX from 'xlsx'

function parseFile(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result
      if (file.name.endsWith('.csv')) {
        const text = data as string
        const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim()))
        resolve(rows)
      } else {
        const workbook = XLSX.read(data, { type: 'binary' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][]
        resolve(rows)
      }
    }
    reader.onerror = reject
    if (file.name.endsWith('.csv')) {
      reader.readAsText(file)
    } else {
      reader.readAsBinaryString(file)
    }
  })
}
```

---

### Step 2 — Column Mapping

Show the detected column headers from the file. For each required/optional field, show a dropdown of detected headers to map to.

**Fields to map:**

| Field | Required | Auto-detect keywords |
|---|---|---|
| First name | Yes | "first", "firstname", "first name", "fname" |
| Last name | Yes | "last", "lastname", "last name", "lname" |
| Email | No | "email", "e-mail", "emailaddress" |
| Phone | No | "phone", "phone number", "mobile", "cell" |
| Employer | No | "employer", "company", "organization", "workplace" |

Auto-detection is case-insensitive. If a column header matches a keyword, pre-select it. Manager can override any mapping via dropdown.

Show a preview of the first 3 data rows below the mapping to help the manager verify the mapping is correct.

`"Next: Preview"` button — disabled until first name and last name are mapped.

---

### Step 3 — Editable Preview

Show ALL rows in a table. Each row is editable inline.

**Columns:** First Name, Last Name, Email, Phone, Employer, Status

**Row status:**
- Valid row — no highlight
- Error row (missing required field) — red background, error message in Status column
- Duplicate row (email matches existing roster record) — yellow background, `"Will be skipped"` badge in Status column

**Inline editing:**
- Any cell can be clicked to edit
- Required fields (first name, last name) show red border if empty
- On edit: re-validate the row immediately

**Import button:**
- Disabled until zero error rows remain
- Label: `"Import [valid count] students"` (duplicate count shown separately)
- Below button: `"[duplicate count] duplicates will be skipped"`

**Row count summary above the table:**
```
X valid  |  Y duplicates (will be skipped)  |  Z errors (must fix before importing)
```

---

### Step 4 — Result

After successful import:
- Green success banner: `"Successfully imported [n] students into [class name]."`
- If any rows were skipped: `"[n] duplicates were skipped."`
- Correction mode is now active — students can confirm their info at superherocpr.com/roster/[session_token]
- If a customer roster was loaded: mark `roster_uploads.imported = true`
- Back to session button → `/admin/sessions/[id]`

---

## Import API Route

**File:** `app/api/roster/import/route.ts`

```typescript
export async function POST(request: Request) {
  const supabase = createClient()
  const { sessionId, students, rosterUploadId } = await request.json()

  // Verify manager/super admin access
  // Re-check for duplicates server-side
  // Batch insert into roster_records
  // Set class_sessions.roster_imported = true
  // Generate session_token if not exists
  // Set correction_window_closes_at = starts_at + 30 min
  // If rosterUploadId provided: mark roster_uploads.imported = true

  const { error } = await supabase.from('roster_records').insert(
    students.map((s: StudentRow) => ({
      session_id: sessionId,
      first_name: s.firstName,
      last_name: s.lastName,
      email: s.email || null,
      phone: s.phone || null,
      employer: s.employer || null,
    }))
  )
  // ...
}
```

---

## Duplicate Detection Rule

A duplicate is defined as: a `roster_record` already exists for this session with the same email address (case-insensitive).

Rows with no email cannot be detected as duplicates — they are always imported. This is by design.

---

## Responsive

- Mobile: Step indicator at top, content below. Column mapping dropdowns full width. Preview table scrolls horizontally.
- Desktop: Comfortable table layout.

---

## What NOT to Do

- Do not upload the file to the server — parse client-side only
- Do not allow instructors to access this page
- Do not hard-block the import for duplicates — skip them and proceed
- Do not import until all error rows are resolved
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to manager and super admin
- [ ] Accepts CSV and Excel (.xlsx, .xls) files
- [ ] Customer roster banner shown when pending upload exists
- [ ] Load Customer Roster pre-loads the file correctly
- [ ] Column auto-detection works for common header name variations
- [ ] Manual column mapping overrides work
- [ ] All rows shown in editable preview table
- [ ] Error rows highlighted red, must be fixed before import
- [ ] Duplicate rows highlighted yellow, shown as skipped
- [ ] Import button disabled while errors exist
- [ ] Inline cell editing re-validates row immediately
- [ ] Import creates roster_records correctly
- [ ] roster_imported set to true on session
- [ ] session_token generated and correction_window_closes_at set
- [ ] roster_uploads.imported set to true if customer roster was used
- [ ] Success result shown with counts
- [ ] Fully responsive with horizontal scroll on preview table
- [ ] No TypeScript errors
- [ ] No ESLint errors
