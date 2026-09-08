# Find a Class Page Guide

**Route:** `/find-a-class`
**Files:**
- `app/(public)/find-a-class/page.tsx` (server: loads catalog + availability)
- `app/(public)/find-a-class/_components/FindAClassWizard.tsx` (client: the walkthrough)
- `lib/class-recommendations.ts` (**the decision table — this is the file you edit**)
- `lib/class-availability.ts` (which classes have bookable dates)
- `lib/class-slug.ts`, `lib/class-display.ts` (shared formatting)

Unlike the other guides in this folder, this one documents a page that already
exists. It is written for whoever changes it next.

---

## Why this page exists

Customers could not tell which course they needed, so they phoned or left a
message, which is exactly the individual service the site is meant to avoid
until class day. This page answers "which class do I need?" without a person.

The goal is **confidence to book what is already scheduled**, not eliminating
every phone call. Some outcomes genuinely need a conversation, and routing those
to Request a Class is a success, not a failure.

---

## The decision tree

Entry is the home page hero's "Book a Class" button (`_components/home/HeroSection.tsx`),
which now routes to /find-a-class instead of straight to /book — most first-time
visitors don't yet know which course they need. The hero's "View Schedule" button
stays on /book for the visitor who does. There is no separate homepage CTA section
for the finder; a dedicated one (FindAClassCta.tsx) existed briefly and was removed
in favor of just repointing the existing button.

```
"I already know what I need, show me the schedule"   -> /book
    (styled and sized identically to the two options above it, but with the
    title/subtitle colors inverted — red title, black subtitle — so it reads
    as "skip this" rather than a third equal choice)

Q1  Who is this class for?
├── A group or workplace                -> /request-class   (terminal, one click)
└── Just me
    └── Q2  Do you know which class you need?
        ├── Yes  -> pick from the catalog -> result
        └── No
            └── Q3  Why do you need this training?
                ├── For my job
                │   └── Q4  What kind of work do you do?   (11 roles + catch-all)
                │       ├── Healthcare or clinical         -> BLS
                │       ├── Critical or acute care         -> ACLS
                │       ├── Body art or cosmetology        -> Blood Borne Pathogens
                │       ├── 8 workplace roles              -> Q5 Do you need First Aid?
                │       │                                     yes -> Heartsaver First Aid CPR AED
                │       │                                     no  -> Heartsaver CPR AED
                │       └── Something else                 -> /request-class
                └── For myself or my family
                    └── Q6  CPR / First Aid / Both
                        └── Q7  Do you need a certification card?
                            ├── Yes -> matching Heartsaver course
                            └── No  -> Family & Friends CPR (CPR only today)
```

**Every path ends in one of two places:** the schedule filtered to the
recommended course (`/book?class=<slug>`) when it has bookable dates, or
`/request-class` when it does not. Nothing dead-ends.

---

## Editing the recommendations

Everything content-related lives in `lib/class-recommendations.ts`.

- **Add or reword a job role:** edit `JOB_ROLES`. Each entry needs an `id`,
  `label`, `examples`, and a `target`.
- **Point a role at a different course:** change its `target`. Use
  `{ kind: "class", course: SOME_COURSE, rationale: "..." }` for a direct
  answer, `{ kind: "heartsaver" }` to ask the First Aid follow-up first, or
  `{ kind: "request", rationale: "..." }` to send them to Request a Class.
- **Add a course:** add a slug constant near the top and reference it.

### Why eight roles share two outcomes

Teacher, childcare, fitness, workplace safety, camp, construction, caregiving and
security all resolve to the same two Heartsaver courses. That is deliberate.
Someone books with confidence when they see *their own job* named. Collapsing
these into a single "are you a healthcare worker?" question would be technically
equivalent and would defeat the entire purpose of the page. Do not "simplify" it.

### Courses are matched by slug, with variants

A course is a **list** of candidate slugs, resolved against the live catalog in
order. Course names are edited in the admin and differ between environments
(production sells "Basic Life Support (BLS) Renewals"; staging has "Basic Life
Support (BLS)"), so a single hardcoded slug would dead-end on one of them.

If you rename a course in the admin, **add the new slug to that course's list.**
If no candidate matches, the walkthrough degrades to a request rather than
showing a broken card, and `tests/e2e/find-a-class.spec.ts` fails because the
course name stops rendering.

---

## Availability

`getClassAvailability()` decides "book it" versus "request it". It counts only
sessions that are scheduled, approved, non-private, in the future, **and still
have a seat**. Students on an unpaid invoice hold their seats, so a class can be
full with zero completed bookings. `/book` uses the same
`computeSpotsRemaining()`, which is the point of the shared helper: two
implementations would eventually disagree and advertise dates for a full class.

**The count is never rendered.** Early versions showed a green "3 upcoming
dates, next Saturday" badge, including on classes with zero dates, while the
visitor was still mid-walkthrough. Seeing scarcity before reaching a
recommendation gives someone a reason to leave the site for a competitor and
has no upside — they cannot act on it until the end anyway. `upcomingCount` now
exists purely to pick the result screen's link (`/book?class=` vs
`/request-class?class=`), never to display a number or date. If you're tempted
to surface it in the UI again, don't — put it on `/book` instead, where a date
picker is the actual point of the page.

---

## Health signals

| Signal | What it covers |
|---|---|
| `tests/e2e/find-a-class.spec.ts` (outcome) | Each branch lands where it should; the recommended course name renders, which only happens when a slug resolved against the live catalog |
| `tests/unit/lib/class-recommendations.test.ts` | Clinical work never resolves to Heartsaver; every branch returns a rationale; slugs are well formed |
| `tests/unit/lib/class-availability.test.ts` | Seat arithmetic, including invoiced seats |

The e2e suite is the one that catches slug drift. It caught a real
staging/production naming mismatch on its first run.

---

## Known gaps

- **Non-certified First Aid** has no class type yet, so "First Aid, no card" and
  "Both, no card" route to Request a Class. There is a `// TODO:` in
  `resolvePersonalRecommendation`. When the class is created, add its slug and
  flip those two outcomes.
- **Blended learning** courses (HeartCode and Online Heartsaver skills
  assessments) appear only as alternates under a primary recommendation, never
  as a primary outcome. They are for people who already did the online
  coursework, so recommending one to someone who has not would sell them a
  skills check they cannot use.

---

## Related

- Phase 2, not yet built: a home-base city dropdown on `/request-class` so
  individuals can pick a city we already teach in instead of nominating a venue,
  with no travel fee for those. Requires allowing multiple home-base locations.
