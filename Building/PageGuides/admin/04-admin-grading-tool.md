# Admin Grading Tool Build Guide
**Route:** `/admin/sessions/[id]/grades`
**File:** `app/(admin)/sessions/[id]/grades/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the grading tool for **Superhero CPR**. This tool is used by instructors after class to enter a grade for every student who attended via rollcall. Grades auto-save individually the moment they are selected. This is one of the most frequently used tools in the system.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database and auth (`@supabase/ssr`)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic.

**Access control:** Instructor (own sessions only) and super admin. No other roles.

---

## Important — Student List Source

The grading tool ONLY shows students from `roster_records` for this session. It does NOT show students from `bookings`. A student must have physically attended and gone through rollcall to appear in the grading tool. A booking alone does not qualify.

---

## Data Fetching

```typescript
// Verify access
if (profile.role === 'instructor' && session.instructor_id !== profile.id) {
  redirect('/admin/sessions')
}

// Fetch session info
const { data: session } = await supabase
  .from('class_sessions')
  .select(`
    id, starts_at, status,
    class_types ( name ),
    locations ( name )
  `)
  .eq('id', params.id)
  .single()

// Fetch roster records (attendees only)
const { data: students } = await supabase
  .from('roster_records')
  .select('id, first_name, last_name, email, employer, grade')
  .eq('session_id', params.id)
  .order('last_name')

// Fetch preset grades
const { data: presetGrades } = await supabase
  .from('preset_grades')
  .select('id, value, label')
  .order('value')
```

---

## Architecture

Hybrid — server fetches initial data, client component handles grade selection and auto-save.

**Server:** `page.tsx` fetches session, students, preset grades → passes to `GradingClient.tsx`

**Client:** `GradingClient.tsx` owns grade state, auto-save logic, visual feedback

---

## Page Header

- Class name and date — `<h1>`
- Location name
- Progress indicator: `"[graded count] of [total] students graded"`
- Progress bar (visual) — fills as grades are entered
- Back link: `"← Back to session"` → `/admin/sessions/[id]`

---

## Student List

Each student row contains:

**Left side:**
- Full name — bold
- Email — muted small text
- Employer — muted small text (if available)

**Right side — grade selector:**
- A row of preset grade buttons — one per entry in `preset_grades`
- Each button shows: `"[value] — [label]"` e.g. `"85 — Pass"`
- Selected grade highlighted in red (`bg-red-600 text-white`)
- Unselected grades: outlined gray buttons
- Custom grade input — a small number input field next to the presets for edge cases
  - Accepts integers only
  - On blur or Enter: saves the custom value

**Save feedback:**
- When a grade is selected (preset or custom): immediately call the save API
- On successful save: green checkmark (`CheckCircle` from Lucide, `text-green-500`) appears next to the student's name for 2 seconds, then fades out
- On save error: red X with `"Save failed — try again"` message that persists until resolved

---

## Auto-Save Logic

```typescript
async function saveGrade(studentId: string, grade: number) {
  setSavingId(studentId)
  try {
    const { error } = await supabase
      .from('roster_records')
      .update({ grade, updated_at: new Date().toISOString() })
      .eq('id', studentId)

    if (error) throw error

    // Show checkmark
    setRecentlySaved(prev => new Set(prev).add(studentId))
    setTimeout(() => {
      setRecentlySaved(prev => {
        const next = new Set(prev)
        next.delete(studentId)
        return next
      })
    }, 2000)

    // Update progress
    setGrades(prev => ({ ...prev, [studentId]: grade }))
  } catch {
    setSaveError(studentId)
  } finally {
    setSavingId(null)
  }
}
```

No Save All button — each grade saves individually and immediately.

---

## Unsaved Navigation Warning

Since grades auto-save, there is no "unsaved" state for individual grades. However if a save is in progress (`savingId !== null`) and the instructor tries to navigate away, show a brief warning: `"Grade is saving..."` — do not block navigation, just inform.

---

## Empty State

If no roster records exist for this session:
- Icon: `Users` from Lucide
- Text: `"No students have registered via rollcall for this session yet."`
- Note: `"Students register at superherocpr.com/rollcall using your daily class code."`

---

## Completion State

When all students are graded (`graded count === total`):
- Progress bar turns fully green
- Banner appears: `"All students have been graded."` with a link back to the session detail

---

## Preset Grade Buttons — Layout

Sort presets by value ascending. On mobile: wrap to two rows if many presets. On desktop: single row.

Each button: minimum 80px wide, consistent height. Active state clear and visually distinct.

---

## Responsive

- Mobile: Student info stacked above grade selector. Grade buttons wrap if needed.
- Desktop: Student info and grade selector side by side in a row.

---

## Accessibility

- Preset grade buttons must be `<button>` elements with `aria-pressed` for selected state
- Custom grade input must have `aria-label="Custom grade for [student name]"`
- Checkmark icon must have `aria-label="Grade saved"` or `aria-hidden="true"` if adjacent text conveys the message
- Progress bar must have `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`

---

## What NOT to Do

- Do not pull from `bookings` for the student list — `roster_records` only
- Do not use a Save All button — auto-save per student
- Do not block navigation during save — just inform
- Do not show this page to managers — instructor (own) and super admin only
- Do not use `any` TypeScript types
- Do not use inline styles

---

## Definition of Done

- [ ] Access restricted to instructor (own session) and super admin
- [ ] Student list pulls from `roster_records` only — not bookings
- [ ] Preset grade buttons render from `preset_grades` table
- [ ] Selecting a preset immediately saves to DB
- [ ] Custom grade input saves on blur or Enter
- [ ] Green checkmark appears for 2 seconds after successful save
- [ ] Save error shown persistently until resolved
- [ ] Progress indicator updates as grades are saved
- [ ] Completion banner shown when all students graded
- [ ] Empty state when no roster records exist
- [ ] Fully responsive
- [ ] No TypeScript errors
- [ ] No ESLint errors
