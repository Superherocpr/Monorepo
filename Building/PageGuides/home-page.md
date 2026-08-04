# Home Page Build Guide
**Route:** `/`  
**File:** `app/(public)/page.tsx`  
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the public-facing home page for **Superhero CPR**, a Tampa, Florida-based CPR certification company. The instructor is a licensed American Heart Association (AHA) instructor with thousands of documented real-world CPR patients. Classes are offered on-location (at homes, offices, and facilities).

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only, no custom CSS files unless absolutely necessary
- **Supabase** — Postgres database and auth (`@supabase/ssr` for server components)
- The project uses the **App Router** — all data fetching should use **React Server Components** wherever possible. Only use `"use client"` when interactivity is required.

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching logic. Do not guess at table or column names.

---

## Your Task

Build the complete `/` home page as a production-quality Next.js page. The page is composed of the following sections, in order. Build each section as its own component in `app/(public)/_components/home/`.

Do not put everything in one file. Each section = one component file.

---

## Section 1 — Hero

**Component:** `HeroSection.tsx`  
**Type:** Server component (no interactivity)

**Layout:**
- Full-width, full-viewport-height section
- Background: dark overlay on a high-quality CPR/first-aid themed background image. Use a placeholder image URL for now — leave a clear `// TODO: replace with final image` comment.
- Centered content, vertically and horizontally

**Content:**
- Headline: `"CPR Certification Classes That Could Save a Life"`
- Subheadline: `"Learn from a licensed American Heart Association instructor with thousands of real-world CPR patients. Flexible scheduling. On-location classes. Tampa Bay area."`
- Two CTA buttons side by side:
  - Primary: `"Book a Class"` → links to `/book`
  - Secondary (outlined): `"View Schedule"` → links to `/schedule`
- Below the buttons, show the **next available class date** pulled live from the database

**Data fetching for next available class:**
```typescript
// Fetch the next upcoming approved class session
// Must be approved — unapproved sessions do not appear publicly
const { data: nextSession } = await supabase
  .from('class_sessions')
  .select('starts_at, class_types(name), locations(name)')
  .eq('status', 'scheduled')
  .eq('approval_status', 'approved')
  .gte('starts_at', new Date().toISOString())
  .order('starts_at', { ascending: true })
  .limit(1)
  .single()
```

Display as: `"Next class: BLS — Tuesday, April 22 at 9:00 AM"`  
If no upcoming class, show nothing (do not show an error or empty state).

---

## Section 2 — Why Choose Us

**Component:** `WhyChooseUsSection.tsx`  
**Type:** Server component

**Layout:** 4 feature cards in a responsive grid (2x2 on mobile, 4x1 on desktop)

**Content — hardcoded, do not pull from DB:**

| Icon | Title | Description |
|---|---|---|
| Shield | AHA Certified Instruction | Receive training from a licensed American Heart Association instructor — the gold standard in CPR certification. |
| Clock | Flexible Scheduling | Morning, afternoon, or evening classes on weekdays and weekends, including most holidays. |
| MapPin | We Come to You | On-location classes at your home, office, or facility. No need to travel. |
| Users | Real-World Experience | Learn from an instructor with thousands of documented real-world CPR patients from active Fire, EMS, and ER response. |

Use Lucide React icons. Cards should have a subtle border, white background, and icon in the brand color (red — use Tailwind `text-red-600`).

---

## Section 3 — Class Types Overview

**Component:** `ClassTypesSection.tsx`  
**Type:** Server component

**Layout:** Heading + subtext + responsive card grid

**Heading:** `"Find the Right Class for You"`  
**Subtext:** `"We offer American Heart Association certification courses for every need — from healthcare professionals to everyday heroes."`

**Data fetching:**
```typescript
// Only show active class types — deactivated types are not visible publicly
const { data: classTypes } = await supabase
  .from('class_types')
  .select('id, name, description, duration_minutes, price')
  .eq('active', true)
  .order('name')
```

**Each card displays:**
- Class name (bold)
- Description
- Duration (e.g. "2 hours")
- Price (e.g. "Starting at $65")
- A `"Learn More"` link → `/classes#[class-name-slug]`
- A `"Book Now"` button → `/book`

If no class types exist in the DB yet (empty state), render 4 skeleton placeholder cards — do not crash or show an error.

---

## Section 4 — Testimonials

**Component:** `TestimonialsSection.tsx`  
**Type:** Client component (`"use client"`) — needs carousel/slideshow interactivity

**Layout:** Section heading + auto-rotating testimonial carousel. One testimonial visible at a time on mobile, up to 2 on desktop. Manual prev/next arrows. Auto-advances every 6 seconds.

**Heading:** `"What Our Students Say"`

**Testimonials — hardcoded array (more will be added later):**

```typescript
const testimonials = [
  {
    quote: "I have been CPR certified for 40 consecutive years. That's A LOT of CPR classes. The absolute best class I ever attended was yours, last week at Casa Mora. Your teaching style combined with your knowledge and love of the material created a positive learning experience for us all. It is so obvious that saving lives is your passion as well as enabling others to do so.",
    author: "Holly Duncan RN, BSN",
    organization: "Casa Mora Rehabilitation & Extended Care"
  }
]
```

Design: quote in large italic serif font, author name bold, organization name muted. Card has a subtle left border accent in red.

Do not use any third-party carousel library. Build the carousel with `useState` and `useEffect` only.

---

## Section 5 — About the Instructor

**Component:** `AboutInstructorSection.tsx`  
**Type:** Server component

**Layout:** Two-column on desktop (image left, text right), stacked on mobile.

**Content — hardcoded:**
- Section label: `"Meet Your Instructor"`
- Name: Pull dynamically — fetch the lead instructor profile from the DB
- Bio text: `"With thousands of documented real-world CPR patients and active experience on the front lines of Fire, EMS, and Emergency Room response, our lead instructor brings unmatched real-world knowledge to every class. This isn't just certification — it's training that could save someone's life."`
- AHA logo/badge below the bio text — use a placeholder with `// TODO: add AHA logo asset`
- CTA link: `"Learn more about our team"` → `/about`

**Data fetching:**
```typescript
// Use is_lead_instructor = true — not role = super_admin
// There is exactly one profile with is_lead_instructor = true
const { data: instructor } = await supabase
  .from('profiles')
  .select('first_name, last_name')
  .eq('is_lead_instructor', true)
  .single()
```

Profile photo: placeholder image for now. Leave `// TODO: replace with real photo` comment.

---

## Section 6 — Social Media Photo Feed

**Component:** `SocialFeedSection.tsx`  
**Type:** Server component (reads from cache table — no client interactivity needed)

**Layout:** Section heading + horizontal scrolling photo strip (5–8 photos)

**Heading:** `"Follow Along"`  
**Subtext:** `"See what's happening at Superhero CPR on Facebook"`  
**Link:** `"Follow us on Facebook"` → `https://www.facebook.com/Super-Hero-CPR-298899580537162/` (opens in new tab)

**Data fetching:**
```typescript
const { data: photos } = await supabase
  .from('social_feed_cache')
  .select('id, photo_url, post_url, caption, posted_at')
  .order('posted_at', { ascending: false })
  .limit(8)
```

**Each photo:**
- Square aspect ratio, object-cover
- On hover: slight dark overlay with a small external link icon
- Clicking opens the original Facebook post in a new tab
- Use Next.js `<Image>` component with appropriate `sizes` prop

**Empty state:** If `social_feed_cache` has no rows yet (table is empty during development), render 8 gray skeleton placeholder squares. Do not show an error.

**Important:** This component only reads from the cache. It does NOT call the Facebook API directly. The cache is populated by a separate background job (not part of this file).

---

## Section 7 — Final CTA

**Component:** `FinalCtaSection.tsx`  
**Type:** Server component

**Layout:** Full-width section, centered, high contrast background (dark red or deep navy — use Tailwind `bg-red-700`)

**Content:**
- Stat callout: `"70–80% of all cardiac arrests happen at home."`
- Headline: `"Be ready when it matters most."`
- Subtext: `"Schedule a class for you, your family, or your entire team. Classes fill up fast."`
- Primary CTA button (white): `"Book Your Class Now"` → `/book`
- Secondary text link (white/muted): `"Have questions? Contact us"` → `/contact`

---

## Page Assembly

**File:** `app/(public)/page.tsx`

```typescript
import HeroSection from './_components/home/HeroSection'
import WhyChooseUsSection from './_components/home/WhyChooseUsSection'
import ClassTypesSection from './_components/home/ClassTypesSection'
import TestimonialsSection from './_components/home/TestimonialsSection'
import AboutInstructorSection from './_components/home/AboutInstructorSection'
import SocialFeedSection from './_components/home/SocialFeedSection'
import FinalCtaSection from './_components/home/FinalCtaSection'

export default async function HomePage() {
  return (
    <main>
      <HeroSection />
      <WhyChooseUsSection />
      <ClassTypesSection />
      <TestimonialsSection />
      <AboutInstructorSection />
      <SocialFeedSection />
      <FinalCtaSection />
    </main>
  )
}
```

The page itself is a server component. Each section handles its own data fetching independently. Do not lift data fetching up to the page level.

---

## Supabase Client Setup

Use the server-side Supabase client in all server components:

```typescript
import { createClient } from '@/lib/supabase/server'

const supabase = createClient()
```

Do not use the browser client in server components. Do not use `useEffect` for data fetching.

---

## Responsive Breakpoints

Use Tailwind's standard breakpoints:
- `sm` — 640px
- `md` — 768px  
- `lg` — 1024px
- `xl` — 1280px

Every section must be fully responsive. Test your mental model at 375px (iPhone SE) and 1440px (desktop).

---

## Typography & Brand

- **Primary color:** Red — `red-600` / `red-700`
- **Font:** System default via Tailwind (can be updated later)
- **Headings:** Bold, large, tight tracking — use `font-bold tracking-tight`
- **Body:** `text-gray-600` on white backgrounds
- **Sections:** Alternate between white (`bg-white`) and light gray (`bg-gray-50`) backgrounds for visual separation

---

## Accessibility Requirements

- Every `<img>` and `<Image>` must have a descriptive `alt` attribute
- All interactive elements must be keyboard navigable
- Color contrast must meet WCAG AA minimum
- Carousel must support keyboard arrow navigation and respect `prefers-reduced-motion`
- Use semantic HTML — `<section>`, `<article>`, `<h1>`, `<h2>`, `<h3>` in correct hierarchy. Only one `<h1>` per page (in the Hero).

---

## What NOT to Do

- Do not use `useEffect` or `useState` for data fetching — use server components
- Do not hardcode Supabase URLs or keys — use environment variables via `process.env`
- Do not import the browser Supabase client in server components
- Do not use `any` TypeScript types — define proper interfaces for all data shapes
- Do not install new npm packages without a comment explaining why the existing stack cannot handle it
- Do not put all sections in a single file
- Do not make the page a client component — keep it a server component
- Do not skip the empty/loading states for DB-driven sections
- Do not use inline styles — Tailwind classes only
- Do not fetch the lead instructor using `role = 'super_admin'` — use `is_lead_instructor = true`
- Do not show sessions that are not `approval_status = 'approved'` on the public site

---

## Definition of Done

The page is complete when:
- [ ] All 7 sections render without errors
- [ ] DB-driven sections (Hero next class, Class Types, About Instructor, Social Feed) have proper empty states
- [ ] Hero next class query filters by both `status = 'scheduled'` AND `approval_status = 'approved'`
- [ ] Class types section only shows active class types
- [ ] About Instructor fetches using `is_lead_instructor = true` not `role = 'super_admin'`
- [ ] Page is fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Carousel auto-advances and respects `prefers-reduced-motion`
- [ ] All images use Next.js `<Image>` component
- [ ] All links are correct and use Next.js `<Link>` component
