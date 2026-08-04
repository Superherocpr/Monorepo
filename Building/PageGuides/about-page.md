# About Page Build Guide
**Route:** `/about`  
**File:** `app/(public)/about/page.tsx`  
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/about` page for **Superhero CPR**, a Tampa, Florida-based CPR certification company. This page is the human face of the business — it introduces the lead instructor, supporting instructors, and the mission behind the company.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database (`@supabase/ssr` for server components)
- **gray-matter** — for parsing markdown frontmatter
- **remark** + **remark-html** — for rendering markdown to HTML

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

Install the following if not already present:
```bash
npm install gray-matter remark remark-html sanitize-html @types/sanitize-html
```

---

## Bio Markdown File Structure

Instructor bios live in the filesystem, not the database. The file structure is:

```
content/
  bios/
    lead-instructor.md
    instructors/
      [bio_slug].md
```

Each markdown file uses frontmatter for structured data and the body for the full bio text:

```markdown
---
title: Lead Instructor
photo: /images/instructors/danny-hedgeman.jpg
credentials:
  - Licensed AHA Instructor
  - Fire & EMS Responder
  - Emergency Room Experience
years_experience: 20
students_trained: 5000+
---

Full bio text goes here. This can be multiple paragraphs, as long as needed.
```

**Lead instructor file:** Always `content/bios/lead-instructor.md` — not keyed to a slug.
**Other instructor files:** Named to match `profiles.bio_slug` e.g. `content/bios/instructors/john-smith.md`.
**Missing file:** If an instructor's bio file does not exist, render their card without bio text. Never crash.

Create a reusable utility at `lib/bios.ts` for reading and parsing these files.

---

## Utility — `lib/bios.ts`

```typescript
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { remark } from 'remark'
import remarkHtml from 'remark-html'

export interface BioFrontmatter {
  title?: string
  photo?: string
  credentials?: string[]
  years_experience?: number
  students_trained?: string
}

export interface ParsedBio {
  frontmatter: BioFrontmatter
  contentHtml: string
}

export async function getLeadInstructorBio(): Promise<ParsedBio | null> {
  const filePath = path.join(process.cwd(), 'content/bios/lead-instructor.md')
  return parseBioFile(filePath)
}

export async function getInstructorBio(slug: string): Promise<ParsedBio | null> {
  const filePath = path.join(process.cwd(), 'content/bios/instructors', `${slug}.md`)
  return parseBioFile(filePath)
}

async function parseBioFile(filePath: string): Promise<ParsedBio | null> {
  try {
    if (!fs.existsSync(filePath)) return null
    const fileContents = fs.readFileSync(filePath, 'utf8')
    const { data, content } = matter(fileContents)
    const processed = await remark().use(remarkHtml).process(content)
    return {
      frontmatter: data as BioFrontmatter,
      contentHtml: processed.toString(),
    }
  } catch {
    return null
  }
}
```

---

## Your Task

Build the complete `/about` page. Each section is its own component in `app/(public)/about/_components/`.

Do not put everything in one file. Each section = one component file.

---

## Section 1 — Hero

**Component:** `AboutHeroSection.tsx`
**Type:** Server component

**Layout:** Full-width section, centered content, medium height (not full viewport)

**Content — hardcoded:**
- Section label (small caps, red): `"Our Story"`
- Headline: `"Saving Lives Is Our Passion"`
- Subtext: `"Superhero CPR was founded on one simple belief — everyone deserves to know how to save a life. We bring American Heart Association certification training directly to you, wherever you are."`

No data fetching. No CTA button.

---

## Section 2 — Lead Instructor

**Component:** `LeadInstructorSection.tsx`
**Type:** Server component

**Layout:** Two-column on desktop (image + credential sidebar left, bio text right). Stacked on mobile with image on top.

**Data fetching — profile:**
```typescript
const supabase = createClient()
const { data: instructor } = await supabase
  .from('profiles')
  .select('first_name, last_name, bio_slug')
  .eq('is_lead_instructor', true)
  .single()
```

**Data fetching — bio:**
```typescript
const bio = await getLeadInstructorBio()
```

**Left column contains:**
- Instructor photo — use `bio.frontmatter.photo` if available, else a placeholder. Always use Next.js `<Image>`. Leave `// TODO: replace placeholder` comment.
- Name: `instructor.first_name + ' ' + instructor.last_name` in large bold text
- AHA badge/logo — placeholder image with `// TODO: add AHA logo asset` comment
- Credentials list — rendered from `bio.frontmatter.credentials` array. Each item gets a red checkmark icon (Lucide `CheckCircle2`, `text-red-600`).
- Stats row — two stat blocks side by side:
  - Years of experience: `bio.frontmatter.years_experience`
  - Students trained: `bio.frontmatter.students_trained`

**Right column contains:**
- Bio HTML rendered from `bio.contentHtml` using `dangerouslySetInnerHTML`
- Sanitize the HTML output using `sanitize-html` before rendering
- Apply Tailwind `prose prose-gray max-w-none` classes to the bio container

**Empty states:**
- If no `is_lead_instructor` profile exists: render a placeholder card with `// TODO: add lead instructor profile` note. Do not crash.
- If `lead-instructor.md` does not exist: render the instructor name and credentials section only, omit the bio text area entirely. Do not crash.

---

## Section 3 — Other Instructors

**Component:** `InstructorTeamSection.tsx`
**Type:** Server component

**Visibility rule:** If zero instructor profiles exist (excluding the lead instructor), return `null`. No empty state, no heading.

**Data fetching:**
```typescript
const { data: instructors } = await supabase
  .from('profiles')
  .select('id, first_name, last_name, bio_slug')
  .eq('role', 'instructor')
  .eq('is_lead_instructor', false)
  .order('last_name')
```

For each instructor, attempt to load their bio:
```typescript
const bios = await Promise.all(
  (instructors ?? []).map(async (instructor) => {
    const bio = instructor.bio_slug
      ? await getInstructorBio(instructor.bio_slug)
      : null
    return { instructor, bio }
  })
)
```

**Layout:** Section heading + responsive card grid (1 col mobile, 2 col tablet, 3 col desktop)

**Heading:** `"Our Instructor Team"`

**Each instructor card contains:**
- Photo — `bio?.frontmatter.photo` or placeholder. Use Next.js `<Image>`.
- Name — bold
- Credentials — `bio?.frontmatter.credentials` as a compact comma-separated string, muted text
- Short bio — `bio?.contentHtml` rendered with `dangerouslySetInnerHTML`. Sanitize before rendering. Apply `prose prose-sm prose-gray max-w-none` classes. If no bio file exists, omit the bio area entirely.

**Card design:** White background, subtle border, rounded corners, consistent height. Photo is square aspect ratio at the top of the card.

---

## Section 4 — Mission & Values

**Component:** `MissionSection.tsx`
**Type:** Server component

**Layout:** Full-width, `bg-gray-50`. Centered content with max-width container.

**Content — hardcoded:**

Heading: `"Why We Do This"`

Three value columns in a responsive grid (1 col mobile, 3 col desktop):

| Icon | Title | Description |
|---|---|---|
| Heart | Passion for Life | Every class we teach is driven by a genuine belief that CPR knowledge saves lives. We have seen it firsthand. |
| Award | Gold Standard Training | We teach exclusively to American Heart Association standards — the most trusted name in emergency cardiovascular care. |
| Home | We Come to You | No commute, no unfamiliar classroom. We bring the training to your home, your office, or your facility. |

Use Lucide React icons. Icon color: `text-red-600`.

Leave a `// TODO: replace placeholder copy with final mission text` comment above each description.

---

## Section 5 — AHA Affiliation

**Component:** `AhaAffiliationSection.tsx`
**Type:** Server component

**Layout:** Two-column on desktop (logo left, text right). Stacked on mobile.

**Content — hardcoded:**
- AHA logo placeholder — `// TODO: add official AHA logo asset`
- Heading: `"American Heart Association Certified"`
- Body: `"The American Heart Association is the world's leading nonprofit organization focused on heart disease and stroke. AHA certification is the gold standard recognized by employers, hospitals, and healthcare organizations nationwide. When you train with Superhero CPR, you receive official AHA certification — the same standard required by healthcare professionals."`
- Small print: `"Superhero CPR is an authorized American Heart Association Training Site."`

No data fetching.

---

## Section 6 — CTA

**Component:** `AboutCtaSection.tsx`
**Type:** Server component

**Layout:** Full-width, `bg-red-700`, centered content

**Content:**
- Heading: `"Ready to Become Certified?"`
- Subtext: `"Join thousands of students who have trained with Superhero CPR. Classes available weekdays, evenings, and weekends."`
- Primary button (white): `"Book a Class"` → `/book`
- Secondary text link (white/muted): `"View the schedule"` → `/schedule`

---

## Page Assembly

**File:** `app/(public)/about/page.tsx`

```typescript
import AboutHeroSection from './_components/AboutHeroSection'
import LeadInstructorSection from './_components/LeadInstructorSection'
import InstructorTeamSection from './_components/InstructorTeamSection'
import MissionSection from './_components/MissionSection'
import AhaAffiliationSection from './_components/AhaAffiliationSection'
import AboutCtaSection from './_components/AboutCtaSection'

export const metadata = {
  title: 'About Us | Superhero CPR',
  description: 'Meet the team behind Superhero CPR — licensed American Heart Association instructors with real-world experience in Fire, EMS, and Emergency Room response.',
}

export default async function AboutPage() {
  return (
    <main>
      <AboutHeroSection />
      <LeadInstructorSection />
      <InstructorTeamSection />
      <MissionSection />
      <AhaAffiliationSection />
      <AboutCtaSection />
    </main>
  )
}
```

---

## Supabase Client Setup

Use the server-side Supabase client in all server components:

```typescript
import { createClient } from '@/lib/supabase/server'

const supabase = createClient()
```

Do not use the browser client in server components.

---

## Seed Content — Create This Placeholder File

Create the following placeholder markdown file so the page renders correctly during development:

**`content/bios/lead-instructor.md`**
```markdown
---
title: Lead Instructor
photo: /images/placeholders/instructor.jpg
credentials:
  - Licensed American Heart Association Instructor
  - Active Fire and EMS Responder
  - Emergency Room Experience
  - Thousands of Documented Real-World CPR Patients
years_experience: 20
students_trained: "5,000+"
---

Bio coming soon. This content will be replaced with the full instructor biography.
```

Do not create placeholder instructor bio files. Wait for real instructor slugs to be added to the database.

---

## Responsive Breakpoints

- `sm` — 640px
- `md` — 768px
- `lg` — 1024px
- `xl` — 1280px

Every section must be fully responsive. Test your mental model at 375px (iPhone SE) and 1440px (desktop).

---

## Typography & Brand

- **Primary color:** Red — `red-600` / `red-700`
- **Prose styling:** Use Tailwind Typography plugin (`prose` classes) for all markdown-rendered bio content. Install if not present: `npm install @tailwindcss/typography`
- **Section alternation:** White and `bg-gray-50` alternating between sections
- **Headings:** `font-bold tracking-tight`

---

## Accessibility Requirements

- Every `<Image>` must have a descriptive `alt` attribute using the instructor's full name
- Credential lists must use `<ul>` and `<li>` — not `<div>` stacks
- Color contrast must meet WCAG AA minimum
- No `<h1>` on this page — use `<h2>` for section headings, `<h3>` for subsections
- All `dangerouslySetInnerHTML` content must be sanitized before render — never skip this

---

## What NOT to Do

- Do not use `useEffect` or `useState` for data fetching
- Do not use `any` TypeScript types — define proper interfaces
- Do not crash if bio markdown files are missing — all bio reads must handle null returns
- Do not render unsanitized HTML — always run through `sanitize-html` before `dangerouslySetInnerHTML`
- Do not hardcode the lead instructor's name — always pull from the database
- Do not render InstructorTeamSection if there are no supporting instructors — return `null`
- Do not install new npm packages without a comment explaining why
- Do not use inline styles — Tailwind classes only
- Do not put all sections in a single file

---

## Definition of Done

The page is complete when:
- [ ] All 6 sections render without errors
- [ ] Page renders correctly when `lead-instructor.md` exists but no instructor bio files exist
- [ ] Page renders correctly when no supporting instructors exist in the DB
- [ ] InstructorTeamSection returns null when no supporting instructors exist
- [ ] All markdown bio content is sanitized before rendering
- [ ] Page is fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] All images use Next.js `<Image>` with descriptive `alt` text
- [ ] Correct `metadata` export for SEO
- [ ] Heading hierarchy is correct — h2 for sections, h3 for subsections, no h1
- [ ] Placeholder seed file `content/bios/lead-instructor.md` exists and renders correctly
