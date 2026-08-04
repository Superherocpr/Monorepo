# Superhero CPR — Design System

This document defines the visual language, design tokens, and component patterns
for the Superhero CPR platform. All Tailwind class names used here are the
authoritative reference — developers should use these classes, not raw hex values.

---

## 1. Brand Foundation

The logo defines the palette: **black figures, gold glow/accents, red "CPR" wordmark,
off-white burst shape.** The platform uses this palette deliberately:

- **Red** is the action color — buttons, CTAs, links, critical alerts
- **Gold** is the brand accent — highlights, active states, decorative flourishes
- **Black/near-black** is the dramatic base — used heavily in the admin, sparingly on the public site
- **White** is the canvas — the public site breathes on white

The two sides of the platform should feel immediately distinct. A staff member
switching between the public site and the admin should know instantly which
environment they're in.

---

## 2. Color Tokens

### Brand Colors

| Token | Tailwind Class | Hex | Usage |
|---|---|---|---|
| Brand Red | `red-600` | `#DC2626` | Primary buttons, CTAs, active links, critical badges |
| Brand Red Dark | `red-700` | `#B91C1C` | Button hover states, pressed states |
| Brand Gold | `amber-400` | `#FBBF24` | Admin active states, accent highlights, decorative |
| Brand Gold Dark | `amber-500` | `#F59E0B` | Gold hover states |
| Brand Black | `gray-950` | `#030712` | Admin sidebar background, logo context |

### Neutral Scale (shared across both sides)

| Token | Tailwind Class | Hex | Usage |
|---|---|---|---|
| Text Primary | `gray-900` | `#111827` | Headings, primary body text |
| Text Secondary | `gray-600` | `#4B5563` | Subtext, descriptions, muted labels |
| Text Muted | `gray-400` | `#9CA3AF` | Placeholder text, disabled states |
| Border Default | `gray-200` | `#E5E7EB` | Card borders, dividers |
| Border Subtle | `gray-100` | `#F3F4F6` | Very light dividers |
| Surface White | `white` | `#FFFFFF` | Card backgrounds, page base |
| Surface Light | `gray-50` | `#F9FAFB` | Alternating section backgrounds |

### Semantic / Status Colors

Used consistently across the entire platform for cert states, booking statuses,
invoice states, order fulfillment, and any other state-driven UI.

| State | Background | Text | Usage |
|---|---|---|---|
| Success / Active / Paid | `green-100` | `green-800` | Active certs, paid invoices, completed sessions |
| Warning / Expiring / Pending | `amber-100` | `amber-800` | Certs expiring <90 days, pending payments, session awaiting approval |
| Danger / Expired / Rejected | `red-100` | `red-700` | Expired certs, rejected sessions, cancelled orders |
| Info / Upcoming / Sent | `blue-100` | `blue-800` | Upcoming bookings, sent invoices, scheduled sessions |
| Neutral / Inactive / Archived | `gray-100` | `gray-600` | Inactive class types, archived accounts, deactivated staff |

**Rule:** Status meaning must always be communicated through text, never color alone.
Every badge must include a label. Icons are additive, not substitutive.

---

## 3. Typography

**Font family:** Inter — loaded via Google Fonts or self-hosted.
Clean, highly legible at all sizes, excellent at data-dense admin UIs, and bold
enough at heavy weights to carry the public site's heroic personality.

```
font-family: 'Inter', system-ui, -apple-system, sans-serif
```

In `tailwind.config.ts`:
```typescript
fontFamily: {
  sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
}
```

### Type Scale

| Level | Tailwind Classes | Usage |
|---|---|---|
| Display | `text-5xl font-extrabold tracking-tight` | Hero headlines (public site only) |
| H1 | `text-4xl font-bold tracking-tight` | Page titles |
| H2 | `text-2xl font-semibold` | Section headings |
| H3 | `text-lg font-semibold` | Card headings, widget titles |
| Body | `text-base font-normal` | General body copy |
| Small | `text-sm font-normal` | Muted descriptions, timestamps |
| Label | `text-sm font-semibold` | Button labels, badge text, form labels |
| Micro | `text-xs font-medium` | Badges, status pills, table headers |

**Line height:** `leading-tight` for headings, `leading-relaxed` for body copy.
**Letter spacing:** `tracking-tight` on Display and H1 only. Normal tracking elsewhere.

---

## 4. Public Site ("Bright and Bold")

The public site is bright and confident. The brand has presence but never
competes with the content — it supports it. The logo's drama lives in hero
sections and CTAs. Content sections breathe on white.

### Public Color Application

```
Page background:      white
Section alternation:  white → gray-50 → white → gray-50
Hero sections:        Can use gray-900 or gradient for dramatic impact
Text (body):          gray-600 on white
Text (headings):      gray-900 on white / white on dark backgrounds
Primary CTA button:   bg-red-600 hover:bg-red-700 text-white
Secondary CTA button: border-red-600 text-red-600 hover:bg-red-50
Gold accent:          Used sparingly — icon highlights, underlines, decorative
```

### Public Hero Sections

Hero sections (home page, schedule page headers) can use a dark background
to give the logo and brand imagery room to breathe — matching the logo's
black backdrop. Content sections immediately below return to white.

```
Hero background option A: bg-gray-900 (dark, dramatic)
Hero background option B: bg-white with a strong red heading (bright, clean)
```

Hero text on dark backgrounds: `text-white` headings, `text-gray-300` subtext.

### Public Component Defaults

**Primary button:**
```
bg-red-600 hover:bg-red-700 text-white font-semibold
px-6 py-3 rounded-lg transition-colors duration-150
```

**Secondary / outline button:**
```
border-2 border-red-600 text-red-600 hover:bg-red-50 font-semibold
px-6 py-3 rounded-lg transition-colors duration-150
```

**Card:**
```
bg-white border border-gray-200 rounded-lg shadow-sm p-6
```

**Section max width:** `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`

**Active nav link:** `text-red-600 font-semibold`

---

## 5. Admin Panel ("Dramatic and Clear")

The admin is immediately distinct from the public site. The sidebar is dark —
matching the logo's black — with gold used for active states. The main content
area is light for readability on data-dense pages. Staff should feel like they
are working in a purpose-built tool, not a public website.

### Admin Color Application

```
Sidebar background:       bg-gray-950   (near-black, matches logo)
Sidebar text (default):   text-gray-400
Sidebar text (hover):     text-gray-100
Sidebar active link:      text-amber-400 font-semibold (gold — the brand accent)
Sidebar active indicator: border-l-2 border-amber-400
Sidebar icon (active):    text-amber-400
Sidebar icon (default):   text-gray-500

Admin header:             bg-gray-900 border-b border-gray-800
Main content background:  bg-gray-50   (light — readable contrast against sidebar)
Content card:             bg-white border border-gray-200 rounded-lg
```

### Admin Primary Actions

The admin uses red for primary buttons — same as the public site. This is
intentional: red means "primary action" universally across the platform.
Gold is reserved for navigation active states and decorative accents only.

```
Primary button:           bg-red-600 hover:bg-red-700 text-white
Destructive button:       bg-red-100 hover:bg-red-200 text-red-700 (softer — for destructive)
Approve / success action: bg-green-600 hover:bg-green-700 text-white
```

### Admin Component Defaults

**Admin card:**
```
bg-white border border-gray-200 rounded-lg shadow-sm
```

**Admin table:**
```
Header row:   bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide
Body rows:    bg-white divide-y divide-gray-100
Hover row:    hover:bg-gray-50
```

**Admin page header:**
```
<h1> text-2xl font-bold text-gray-900
Subtext: text-sm text-gray-500 mt-1
```

**Admin section max width:** Full fluid width. No centering constraint on admin pages.
Use padding `px-6 py-6` on the main content container.

**Admin filter pills:**
```
Active:   bg-red-600 text-white text-sm font-medium px-3 py-1.5 rounded-full
Inactive: bg-white border border-gray-200 text-gray-600 text-sm px-3 py-1.5 rounded-full
          hover:border-gray-300
```

---

## 6. Dark Mode

Dark mode is stored in `localStorage` under the key `theme` (`'dark'` | `'light'`).
It is device-specific. Tailwind's `dark:` variant strategy applies the dark class
to `document.documentElement`.

In `tailwind.config.ts`:
```typescript
darkMode: 'class',
```

The admin layout includes a script in `<head>` to prevent flash of unstyled content:
```html
<script dangerouslySetInnerHTML={{
  __html: `
    (function() {
      if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.classList.add('dark');
      }
    })();
  `
}} />
```

### Dark Mode — Public Site

The public site in dark mode stays clean. Backgrounds invert to near-black,
text inverts to near-white, red and gold remain vibrant.

```
dark:bg-gray-950     ← page backgrounds
dark:bg-gray-900     ← card/surface backgrounds
dark:text-white      ← primary headings
dark:text-gray-300   ← body text
dark:border-gray-700 ← borders
```

### Dark Mode — Admin Panel

The admin sidebar is already dark — dark mode deepens the content area to match.

```
dark:bg-gray-900     ← main content area (was gray-50)
dark:bg-gray-800     ← cards (was white)
dark:text-white      ← headings
dark:text-gray-300   ← body/muted text
dark:border-gray-700 ← borders (was gray-200)
```

---

## 7. Spacing Scale

Tailwind's default spacing scale is used without customization.
These are the standard spacings used at layout level:

| Usage | Value |
|---|---|
| Section vertical padding (public) | `py-16` (64px) or `py-24` (96px) for large hero sections |
| Section vertical padding (admin) | `py-6` (24px) |
| Card internal padding (public) | `p-6` (24px) |
| Card internal padding (admin) | `p-4` (16px) or `p-5` (20px) |
| Form field spacing | `space-y-4` between fields |
| Page header to content gap | `mt-6` or `mt-8` |
| Sidebar width | `w-64` (256px) on desktop |
| Sidebar collapsed | `w-16` (64px) — icon-only (if implemented) |

---

## 8. Border Radius

| Context | Class | Value |
|---|---|---|
| Buttons (all) | `rounded-lg` | 8px |
| Cards (public) | `rounded-xl` | 12px |
| Cards (admin) | `rounded-lg` | 8px |
| Badges / pills | `rounded-full` | full |
| Inputs | `rounded-lg` | 8px |
| Modals / slide-in panels | `rounded-xl` | 12px |

---

## 9. Shadows

| Context | Class |
|---|---|
| Public cards | `shadow-sm` |
| Public hero cards / featured | `shadow-md` |
| Admin cards | `shadow-sm` |
| Dropdowns / popovers | `shadow-lg` |
| Modals | `shadow-xl` |
| Slide-in panels | No shadow — full-height, bordered |

---

## 10. Form Inputs

Consistent across both public and admin unless noted.

```
Base input:
  border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900
  placeholder:text-gray-400
  focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent
  dark:bg-gray-800 dark:border-gray-600 dark:text-white

Error state:
  border-red-500 focus:ring-red-500
  + error message: text-sm text-red-600 mt-1

Disabled state:
  bg-gray-100 text-gray-400 cursor-not-allowed
```

**Focus ring is red across both sides** — this maintains brand consistency even
in the admin. The dark sidebar is what makes the admin feel distinct, not the
input focus color.

---

## 11. Slide-in Panels (Admin)

Used for: create customer, invite staff, add booking, issue cert, adjust stock, etc.

```
Overlay:        fixed inset-0 bg-black/50 z-40
Panel:          fixed right-0 top-0 h-full w-full sm:w-[480px]
                bg-white dark:bg-gray-900
                border-l border-gray-200 dark:border-gray-700
                shadow-xl z-50 overflow-y-auto
Panel header:   px-6 py-4 border-b border-gray-200 flex justify-between items-center
Panel body:     px-6 py-6 space-y-5
Panel footer:   px-6 py-4 border-t border-gray-200 flex justify-end gap-3
```

---

## 12. Toast Notifications

```
Success: bg-green-50 border border-green-200 text-green-800
Error:   bg-red-50 border border-red-200 text-red-800
Info:    bg-blue-50 border border-blue-200 text-blue-800
Warning: bg-amber-50 border border-amber-200 text-amber-800

Position:    fixed bottom-4 right-4 z-50
Width:       max-w-sm w-full
Shape:       rounded-lg shadow-lg p-4
Animation:   translate-x on enter/exit (slide from right)
Duration:    4 seconds auto-dismiss. Errors stay until dismissed.
```

---

## 13. Loading / Skeleton States

Used in sections that fetch data (schedule, analytics, admin lists).

```
Skeleton base:      bg-gray-200 dark:bg-gray-700 rounded animate-pulse
Single line:        h-4 w-3/4 (varies by content)
Block/card:         h-24 w-full rounded-lg
Avatar/circle:      h-10 w-10 rounded-full
```

---

## 14. Empty States

Used when a list or section has no data.

```
Container:    text-center py-16
Icon:         Lucide icon, text-gray-300 dark:text-gray-600, size 48px (h-12 w-12 mx-auto mb-4)
Heading:      text-lg font-semibold text-gray-900 dark:text-white
Body:         text-sm text-gray-500 mt-1 max-w-sm mx-auto
CTA button:   mt-4, standard primary button (if action available)
```

---

## 15. Visual Distinction Summary

This table should be the litmus test when building any component.
If a design decision blurs the line between these two contexts, it's wrong.

| | Public Site | Admin Panel |
|---|---|---|
| **Primary background** | `white` | `gray-50` (content) + `gray-950` (sidebar) |
| **Heading color** | `gray-900` | `gray-900` |
| **Primary action** | `red-600` button | `red-600` button |
| **Brand accent** | Gold used sparingly | Gold for active nav states |
| **Nav active color** | `red-600` | `amber-400` (gold) |
| **Card style** | `rounded-xl shadow-sm` | `rounded-lg shadow-sm` |
| **Spacing density** | Generous (`py-16`) | Compact (`py-6`) |
| **Max width** | `max-w-7xl` centered | Full width, padded |
| **Dark mode feel** | Inverted bright site | Deepened dramatic tool |

---

## 16. Tailwind Config Extensions

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Brand shorthands for convenience
        brand: {
          red:       '#DC2626', // = red-600
          'red-dark':'#B91C1C', // = red-700
          gold:      '#FBBF24', // = amber-400
          'gold-dark':'#F59E0B',// = amber-500
          black:     '#030712', // = gray-950
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'), // for prose/bio markdown rendering
  ],
}

export default config
```

Note: The `brand.*` shorthand colors are optional convenience aliases.
Prefer the standard Tailwind classes (`red-600`, `amber-400`, `gray-950`) in
component code for consistency with the rest of Tailwind's system.
