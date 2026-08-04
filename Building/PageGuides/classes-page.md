# Classes Page Build Guide
**Route:** `/classes`  
**File:** `app/(public)/classes/page.tsx`  
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/classes` page for **Superhero CPR**, a Tampa, Florida-based CPR certification company. This page describes every available course offering in detail and serves as the primary reference for customers deciding which class to book.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database (`@supabase/ssr` for server components)

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

---

## Your Task

Build the complete `/classes` page. Each section is its own component in `app/(public)/classes/_components/`.

Do not put everything in one file. Each section = one component file.

---

## Section 1 — Hero

**Component:** `ClassesHeroSection.tsx`
**Type:** Server component

**Layout:** Full-width, centered, medium height (not full viewport)

**Content — hardcoded:**
- Section label (small caps, red): `"Our Courses"`
- Headline: `"American Heart Association Certification Classes"`
- Subtext: `"We offer a full range of AHA-certified CPR courses for healthcare professionals, workplace teams, and everyday people who want to be ready when it counts."`

No data fetching. No CTA.

---

## Section 2 — Class Type Cards

**Component:** `ClassTypeCards.tsx`
**Type:** Server component

**Data fetching:**
```typescript
const supabase = createClient()
const { data: classTypes } = await supabase
  .from('class_types')
  .select('id, name, description, duration_minutes, max_capacity, price')
  .order('name')
```

**Layout:** Vertical stack of full-width cards, each with a left accent border in red. Not a grid — each card is its own full-width row to allow for more content per class.

**Each card must have:**
- An HTML anchor ID derived from the class name slug so the home page can link directly to it:
```typescript
const slug = classType.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
// e.g. "CPR+AED" → "cpr-aed", "BLS" → "bls"
```
Render as: `<section id={slug}>`

**Each card displays:**
- Class name — large bold heading (`h2`)
- Description — full text from DB
- Three detail badges in a row:
  - Duration: formatted as hours/minutes e.g. `duration_minutes = 120` → `"2 hours"`, `duration_minutes = 90` → `"1 hr 30 min"`
  - Max class size: e.g. `"Up to 12 students"`
  - Price: formatted as currency e.g. `"$65 per person"`
- "Book This Class" button → `/book?class=[slug]` (passes class slug as a query param so the booking flow can pre-select it)
- "View Schedule" text link → `/schedule?class=[slug]`

**Duration formatting utility — write this inline in the component:**
```typescript
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (mins === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`
  return `${hours} hr ${mins} min`
}
```

**Empty state:** If no class types exist in the DB yet, render a single placeholder card with a note: `"Class types are being added. Check back soon."` Do not crash or render an empty page.

---

## Section 3 — How It Works

**Component:** `HowItWorksSection.tsx`
**Type:** Server component

**Layout:** Full-width, `bg-gray-50`. Section heading + 4 horizontal steps on desktop, vertical stack on mobile. Steps connected by a subtle arrow or line between them on desktop.

**Heading:** `"How It Works"`

**Steps — hardcoded:**

| Step | Icon | Title | Description |
|---|---|---|---|
| 1 | BookOpen | Choose your class | Browse our AHA-certified courses and pick the one that fits your needs. |
| 2 | Calendar | Pick a date | View available sessions and choose a date and time that works for your schedule. |
| 3 | CreditCard | Pay online | Securely complete your booking with PayPal. Payment is required to hold your spot. |
| 4 | Award | Get certified | Attend your class, pass your skills test, and walk away with your AHA certification. |

Use Lucide React icons. Step numbers displayed as large red numerals (`text-red-600 font-bold text-4xl`) above each icon. Icon size: 32px, color `text-red-600`.

No data fetching.

---

## Section 4 — FAQ

**Component:** `ClassesFaqSection.tsx`
**Type:** Client component (`"use client"`) — needs accordion interactivity

**Layout:** Section heading + list of accordion items. One item open at a time (clicking a new item closes the currently open one).

**Heading:** `"Frequently Asked Questions"`

**FAQ items — hardcoded array:**

```typescript
const faqs = [
  {
    question: "What should I bring to class?",
    answer: "Nothing special is required. Wear comfortable clothing you can move in — you will be practicing CPR techniques on a mannequin. We bring all the training equipment."
  },
  {
    question: "How long is my AHA certification valid?",
    answer: "Most AHA certifications are valid for 2 years. You will receive a reminder before your certification expires so you can schedule a renewal class."
  },
  {
    question: "Can I book a class for my entire team or workplace?",
    answer: "Absolutely. We specialize in on-location group training at your facility or workplace. Contact us to arrange a session for your team."
  },
  {
    question: "What is the difference between BLS and Heartsaver?",
    answer: "BLS (Basic Life Support) is designed for healthcare professionals and requires hands-on skills testing. Heartsaver is designed for non-medical workplace responders and the general public. Both result in full AHA certification."
  },
  {
    question: "Do I need any prior experience or training?",
    answer: "No prior experience is required for any of our courses. Our instructors guide you through everything step by step."
  },
  {
    question: "What payment methods do you accept?",
    answer: "Online bookings are paid securely through PayPal. In-person payments can be made by cash or check."
  },
  {
    question: "Is the certification accepted by hospitals and employers?",
    answer: "Yes. AHA certification from Superhero CPR is recognized by hospitals, clinics, schools, and employers nationwide."
  },
  {
    question: "What happens if I need to cancel my booking?",
    answer: "Please contact us as soon as possible if you need to cancel. We do not offer refunds, but we will do our best to accommodate rescheduling."
  }
]
```

**Accordion behavior:**
- Each item has a question row (clickable) with a chevron icon that rotates on open/close
- Answer text animates open/close using CSS `max-height` transition — do not use a library
- Only one item open at a time — `useState` tracks the currently open index
- Use `null` as the initial state (all items closed by default)

**Do not use any accordion library.** Build with `useState` and CSS transitions only.

---

## Section 5 — CTA

**Component:** `ClassesCtaSection.tsx`
**Type:** Server component

**Layout:** Full-width, `bg-red-700`, centered content

**Content:**
- Heading: `"Ready to Get Started?"`
- Subtext: `"Browse available class dates or book your session now. Tampa Bay area. Weekdays, evenings, and weekends available."`
- Two buttons side by side:
  - Primary (white): `"Book a Class"` → `/book`
  - Secondary (white outline): `"View Schedule"` → `/schedule`

---

## Page Assembly

**File:** `app/(public)/classes/page.tsx`

```typescript
import ClassesHeroSection from './_components/ClassesHeroSection'
import ClassTypeCards from './_components/ClassTypeCards'
import HowItWorksSection from './_components/HowItWorksSection'
import ClassesFaqSection from './_components/ClassesFaqSection'
import ClassesCtaSection from './_components/ClassesCtaSection'

export const metadata = {
  title: 'CPR Certification Classes | Superhero CPR',
  description: 'American Heart Association CPR certification classes in Tampa Bay. BLS, Heartsaver, CPR+AED, and Pediatric CPR. Flexible scheduling, on-location training.',
}

export default async function ClassesPage() {
  return (
    <main>
      <ClassesHeroSection />
      <ClassTypeCards />
      <HowItWorksSection />
      <ClassesFaqSection />
      <ClassesCtaSection />
    </main>
  )
}
```

---

## Anchor Link Behavior

The home page links to specific class types using anchor links e.g. `/classes#bls`. This works automatically because each class card is wrapped in a `<section id={slug}>`. No special scroll behavior needed — the browser handles native anchor navigation.

However, add smooth scrolling to the root layout if not already present:
```css
/* In globals.css or tailwind base layer */
html {
  scroll-behavior: smooth;
}
```

---

## Supabase Client Setup

```typescript
import { createClient } from '@/lib/supabase/server'

const supabase = createClient()
```

Use server-side client only. Do not use browser client in server components.

---

## Responsive Breakpoints

- `sm` — 640px
- `md` — 768px
- `lg` — 1024px
- `xl` — 1280px

Every section must be fully responsive. Test at 375px (iPhone SE) and 1440px (desktop).

The How It Works steps must stack vertically on mobile and sit horizontally on desktop (`lg:flex-row`). The connecting line/arrow between steps is only visible on desktop (`hidden lg:block`).

---

## Typography & Brand

- **Primary color:** Red — `red-600` / `red-700`
- **Section alternation:** White and `bg-gray-50` alternating
- **Card accent:** Left border `border-l-4 border-red-600` on each class type card
- **Headings:** `font-bold tracking-tight`
- **Price formatting:** Always use `toLocaleString('en-US', { style: 'currency', currency: 'USD' })` — never hardcode `$` symbols with raw numbers

---

## Accessibility Requirements

- Each class type card's `<section>` must also have `aria-labelledby` pointing to its heading ID
- FAQ accordion items must use `<button>` for the clickable question row — not `<div>`
- FAQ answer panels must have `aria-expanded` and `aria-controls` attributes on the trigger button
- Chevron icon rotation must be driven by a CSS class, not inline style, so it respects `prefers-reduced-motion`
- Color contrast must meet WCAG AA
- Heading hierarchy: `<h1>` is not used on this page. Section headings are `<h2>`. Class type names are `<h2>` (they are the primary content items). How It Works step titles are `<h3>`.

---

## What NOT to Do

- Do not use any accordion or animation library — build with useState and CSS only
- Do not use `any` TypeScript types
- Do not hardcode class type data — always pull from the DB
- Do not crash if the DB returns no class types — show the empty state card
- Do not format duration or price as raw numbers — use the formatting helpers
- Do not use inline styles — Tailwind only
- Do not put all sections in one file
- Do not add `scroll-behavior: smooth` inside a component — it belongs in the global stylesheet

---

## Definition of Done

The page is complete when:
- [ ] All 5 sections render without errors
- [ ] Each class type card has a correct anchor ID matching its slug
- [ ] Home page "Learn More" links correctly jump to the right class card
- [ ] Duration and price are correctly formatted
- [ ] FAQ accordion opens and closes correctly — only one item open at a time
- [ ] FAQ accordion built with useState and CSS only — no library
- [ ] Empty state renders when no class types exist in DB
- [ ] Page is fully responsive from 375px to 1440px
- [ ] How It Works steps stack on mobile, sit horizontal on desktop
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export for SEO
- [ ] Heading hierarchy is correct
- [ ] FAQ accordion is fully accessible (button elements, aria attributes)
