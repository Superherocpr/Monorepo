# Contact Page Build Guide
**Route:** `/contact`
**File:** `app/(public)/contact/page.tsx`
**Target AI:** Claude Sonnet 4.6 Thinking in VSCode

---

## Context — Read This First

You are building the `/contact` page for **Superhero CPR**. This page handles general inquiries, group booking requests, and corporate training inquiries. It includes a contact form that stores submissions in the database AND sends email notifications via Resend.

This is a **Next.js 14+ App Router** project using:
- **TypeScript** — strict mode, no `any`
- **Tailwind CSS** — utility classes only
- **Supabase** — Postgres database (`@supabase/ssr`)
- **Resend** — for transactional emails

Read the full schema at `/Volumes/Work/Face2Face/SuperheroCPR/Monorepo/schema.md` before writing any data fetching or insert logic. Do not guess at table or column names.

---

## Schema Addition

This page requires a new table. Add it to Supabase before building the page.

### `contact_submissions`

```sql
create table contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  inquiry_type text not null,
  message text not null,
  replied boolean not null default false,
  created_at timestamptz not null default now()
);
```

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Default: gen_random_uuid() |
| name | text NN | Submitter's full name |
| email | text NN | Submitter's email |
| phone | text | Optional |
| inquiry_type | text NN | One of the dropdown options |
| message | text NN | Full message body |
| replied | boolean NN | Default: false. Staff can mark as replied in admin panel. |
| created_at | timestamptz NN | Default: now() |

---

## Your Task

Build the complete `/contact` page. Each section is its own component in `app/(public)/contact/_components/`.

Do not put everything in one file. Each section = one component file.

---

## Section 1 — Hero

**Component:** `ContactHeroSection.tsx`
**Type:** Server component

**Layout:** Full-width, centered, compact height

**Content — hardcoded:**
- Section label (small caps, red): `"Get In Touch"`
- Headline: `"We'd Love to Hear From You"`
- Subtext: `"Have a question about our classes? Interested in group or corporate training? Reach out and we'll get back to you as soon as possible."`

No data fetching.

---

## Section 2 — Contact Info + Form

**Component:** `ContactSection.tsx`
**Type:** Client component (`"use client"`) — form interactivity required

**Layout:** Two-column on desktop (contact info left, form right). Stacked on mobile with contact info on top.

### Left Column — Contact Info

Hardcoded content:

**Phone:**
- Label: `"Call Us"`
- Number: `"(813) 966-3969"` — render as `<a href="tel:+18139663969">`

**Email:**
- Label: `"Email Us"`
- Address: `"info@superherocpr.com"` — render as `<a href="mailto:info@superherocpr.com">`

**Response time note:**
- `"We typically respond within 1 business day."`

**Service area:**
- Label: `"Service Area"`
- Text: `"We serve the greater Tampa Bay area including Tampa, St. Petersburg, Clearwater, Brandon, and surrounding communities."`

Each contact method gets an icon from Lucide React:
- Phone: `Phone` icon
- Email: `Mail` icon
- Service area: `MapPin` icon

Icon color: `text-red-600`

### Right Column — Contact Form

**Form fields:**
- Full name (required) — text input
- Email (required) — email input
- Phone (optional) — tel input
- Inquiry type (required) — `<select>` dropdown with these options:
  ```
  General Question
  Group Booking (5+ people)
  Corporate / Workplace Training
  Certification Renewal
  Other
  ```
- Message (required) — `<textarea>` with min height 120px

**Submit button:** `"Send Message"` — full width, red background

**Form states:**
- Default: form visible, button enabled
- Submitting: button shows `"Sending..."` and is disabled — do not use a spinner library, just change the button text
- Success: hide the form entirely, show a success message:
  ```
  "Message sent!"
  "Thanks for reaching out, [firstName]. We'll get back to you at [email] within 1 business day."
  ```
  Use the submitted name and email in this message.
- Error: show an inline error below the button:
  ```
  "Something went wrong. Please try again or email us directly at info@superherocpr.com"
  ```

**Form submission — call API route:**
```typescript
const response = await fetch('/api/contact', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(formData),
})
```

Do not call Supabase or Resend directly from the client component. All DB writes and email sends happen in the API route.

---

## API Route — Contact Form

**File:** `app/api/contact/route.ts`

This route must:
1. Validate all required fields — return `400` if any are missing
2. Insert the submission into `contact_submissions`
3. Send a notification email to the business
4. Send an auto-reply confirmation to the submitter

```typescript
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: Request) {
  const supabase = createClient()
  const body = await request.json()

  const { name, email, phone, inquiryType, message } = body

  // Step 1: Validate
  if (!name || !email || !inquiryType || !message) {
    return Response.json(
      { success: false, error: 'Missing required fields' },
      { status: 400 }
    )
  }

  // Step 2: Store in DB
  const { error: dbError } = await supabase
    .from('contact_submissions')
    .insert({
      name,
      email,
      phone: phone || null,
      inquiry_type: inquiryType,
      message,
    })

  if (dbError) {
    console.error('Failed to store contact submission:', dbError)
    return Response.json(
      { success: false, error: 'Failed to store submission' },
      { status: 500 }
    )
  }

  // Step 3: Notify the business
  await resend.emails.send({
    from: 'Superhero CPR Website <noreply@superherocpr.com>',
    to: 'info@superherocpr.com',
    subject: `New Contact Form Submission — ${inquiryType}`,
    html: `
      <h2>New contact form submission</h2>
      <table>
        <tr><td><strong>Name:</strong></td><td>${name}</td></tr>
        <tr><td><strong>Email:</strong></td><td>${email}</td></tr>
        <tr><td><strong>Phone:</strong></td><td>${phone || 'Not provided'}</td></tr>
        <tr><td><strong>Inquiry type:</strong></td><td>${inquiryType}</td></tr>
      </table>
      <h3>Message:</h3>
      <p>${message}</p>
    `,
  })

  // Step 4: Auto-reply to submitter
  const firstName = name.split(' ')[0]
  await resend.emails.send({
    from: 'Superhero CPR <noreply@superherocpr.com>',
    to: email,
    subject: 'We received your message — Superhero CPR',
    html: `
      <h1>Thanks for reaching out, ${firstName}!</h1>
      <p>We received your message and will get back to you within 1 business day.</p>
      <p>If your matter is urgent, you can also reach us at:</p>
      <ul>
        <li>Phone: <a href="tel:+18139663969">(813) 966-3969</a></li>
        <li>Email: <a href="mailto:info@superherocpr.com">info@superherocpr.com</a></li>
      </ul>
      <p>— The Superhero CPR Team</p>
    `,
  })

  return Response.json({ success: true })
}
```

---

## Section 3 — Tampa Bay Service Area Map

**Component:** `ServiceAreaMap.tsx`
**Type:** Server component

**Layout:** Full-width section, `bg-gray-50`. Heading above a static map image.

**Heading:** `"Serving the Tampa Bay Area"`
**Subtext:** `"On-location classes available throughout Tampa, St. Petersburg, Clearwater, Brandon, Wesley Chapel, and surrounding areas."`

**Map:** Use a static map image of the Tampa Bay area. Source the image from:
```
https://maps.googleapis.com/maps/api/staticmap?center=Tampa,FL&zoom=10&size=1200x400&scale=2&maptype=roadmap&key=YOUR_API_KEY
```

However, since no Google Maps API key is available yet, use a placeholder:
- Render a gray placeholder div with dimensions `w-full h-64 md:h-96` and `bg-gray-200 rounded-lg`
- Add text inside: `"Tampa Bay Area Service Map"`
- Leave a prominent comment: `// TODO: Replace with static map image — see /public/images/tampa-bay-map.png or use Google Static Maps API`

The placeholder must not crash or show a broken image. Use a `<div>` placeholder, not an `<img>` with a broken src.

**Alternative approach (preferred):** Download a static PNG map of Tampa Bay and save it to `/public/images/tampa-bay-map.png`. Use Next.js `<Image>` with that path. Leave `// TODO: replace with final map asset` comment. The build should not fail if the file doesn't exist yet — wrap in a try/catch or use a conditional render.

---

## Section 4 — FAQ Teaser

**Component:** `ContactFaqTeaser.tsx`
**Type:** Server component

**Layout:** Centered, white background. Three FAQ items displayed as simple static question/answer pairs (no accordion — just open).

**Heading:** `"Quick Answers"`

**Three hardcoded FAQ items:**

1. **Q:** How far in advance should I book?
   **A:** We recommend booking at least a few days in advance as classes fill up quickly. Check the schedule for current availability.

2. **Q:** Do you offer group or corporate training?
   **A:** Yes — we specialize in on-location group training for workplaces, facilities, and families. Contact us to arrange a private session.

3. **Q:** What if I need to reschedule?
   **A:** Contact us as soon as possible and we will do our best to accommodate you. Please note that we do not offer refunds.

**CTA link below the FAQs:** `"See all FAQs"` → `/classes#faq`

---

## Page Assembly

**File:** `app/(public)/contact/page.tsx`

```typescript
import ContactHeroSection from './_components/ContactHeroSection'
import ContactSection from './_components/ContactSection'
import ServiceAreaMap from './_components/ServiceAreaMap'
import ContactFaqTeaser from './_components/ContactFaqTeaser'

export const metadata = {
  title: 'Contact Us | Superhero CPR',
  description: 'Get in touch with Superhero CPR. Questions about CPR classes, group bookings, or corporate training in the Tampa Bay area.',
}

export default function ContactPage() {
  return (
    <main>
      <ContactHeroSection />
      <ContactSection />
      <ServiceAreaMap />
      <ContactFaqTeaser />
    </main>
  )
}
```

Note: This page is a server component at the top level, but `ContactSection` is a client component. This is correct — Next.js handles the boundary automatically.

---

## Supabase Client in API Route

The API route uses the server-side Supabase client:
```typescript
import { createClient } from '@/lib/supabase/server'
const supabase = createClient()
```

The Supabase client in API routes does not have user context unless you pass auth headers. For this route that is fine — contact submissions are public (no auth required).

---

## Responsive Breakpoints

- Mobile (< `lg`): Single column, contact info stacked above form
- Desktop (`lg`+): Two-column layout, contact info left, form right

Form must be fully usable at 375px width. All inputs full width on mobile.

---

## Typography & Brand

- **Primary color:** Red — `red-600` / `red-700`
- **Contact info icons:** `text-red-600`, size 20px
- **Form submit button:** `bg-red-600 hover:bg-red-700 text-white`
- **Section alternation:** White for hero + contact section, `bg-gray-50` for map, white for FAQ teaser

---

## Accessibility Requirements

- All form inputs must have associated `<label>` elements — never use placeholder text as a label substitute
- Required fields must have `required` attribute and `aria-required="true"`
- The `<select>` dropdown must have a visible label
- `<textarea>` must have a visible label
- Success and error messages must use `role="alert"` so screen readers announce them immediately
- Phone and email links must have descriptive `aria-label` attributes:
  - `aria-label="Call Superhero CPR at (813) 966-3969"`
  - `aria-label="Email Superhero CPR at info@superherocpr.com"`
- Color contrast must meet WCAG AA

---

## What NOT to Do

- Do not call Supabase or Resend directly from the client component — use the API route
- Do not use `alert()` for success or error states
- Do not use a spinner library — change button text to `"Sending..."` only
- Do not skip storing the submission in the DB — both email and DB insert are required
- Do not skip the auto-reply email to the submitter
- Do not use a broken `<img>` src for the map placeholder — use a `<div>` placeholder
- Do not use `any` TypeScript types
- Do not use inline styles — Tailwind only
- Do not put all sections in one file

---

## Definition of Done

The page is complete when:
- [ ] Hero, contact info, form, map, and FAQ teaser all render without errors
- [ ] Form validates all required fields before submitting
- [ ] Successful submission stores record in `contact_submissions` table
- [ ] Successful submission sends notification email to `info@superherocpr.com`
- [ ] Successful submission sends auto-reply email to the submitter
- [ ] Form shows success state with submitter's name and email after submission
- [ ] Form shows inline error state if API call fails
- [ ] Button shows `"Sending..."` and is disabled during submission
- [ ] Map section renders without crashing even if map image is missing
- [ ] FAQ teaser renders with link to `/classes#faq`
- [ ] Page is fully responsive from 375px to 1440px
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No ESLint errors
- [ ] Correct `metadata` export for SEO
- [ ] All form inputs have visible labels and correct aria attributes
