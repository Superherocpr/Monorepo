# Superhero CPR — Copilot Instructions

These rules apply to every file you touch in this project, every time, without exception.
They are not suggestions. Do not override them based on context or convenience.

---

## 1. Document Everything

A human must be able to understand any piece of code without asking you what it does.

**Functions and methods:** Every function gets a JSDoc comment. No exceptions.
Describe what it does, what each parameter is, and what it returns. If a function
has side effects (DB write, email send, S3 upload), name them explicitly.

```typescript
/**
 * Decrements stock for a product variant atomically via Supabase RPC.
 * Uses greatest(..., 0) to prevent negative stock.
 * @param variantId - UUID of the product_variants record
 * @param amount - Number of units to decrement
 */
async function decrementStock(variantId: string, amount: number): Promise<void> {
```

**Non-obvious logic:** Any line or block that isn't immediately obvious from reading it
gets an inline comment explaining the WHY, not the what. The what is visible in the code.
The why is not.

```typescript
// Invoice students count against capacity even before payment —
// an unpaid invoice still reserves spots to prevent overbooking
const invoiceStudents = invoices
  .filter(inv => inv.status !== 'cancelled')
  .reduce((sum, inv) => sum + inv.student_count, 0)
```

**API routes:** Every route file gets a comment block at the top naming the method,
path, who can call it, and what it does.

```typescript
/**
 * POST /api/bookings/confirm
 * Called by: Public booking flow (Step 4 PayPal onApprove)
 * Auth: None required — PayPal transaction ID is the verification
 * Re-verifies spot availability, creates booking + payment records, sends confirmation email.
 */
```

**Components:** Every component file gets a one-line comment at the top stating its
purpose and which page(s) use it.

**TODOs:** When something is intentionally incomplete or deferred, leave a comment:
`// TODO: [what needs doing and why it was deferred]`
Do not leave silent gaps.

---

## 2. No Zombie Code

Code that is not doing anything must not exist in this codebase.

**Delete immediately when:**
- You refactor a function and the old version is no longer called anywhere
- A feature is replaced and the old implementation is still present
- A component is replaced by a better one and the old one sits unused
- A utility was written for a specific page and that page no longer uses it
- A commented-out block of code has been sitting there through more than one edit

**The rule:** Before finishing any task, search for code that your changes made
obsolete. Remove it. Do not leave it "just in case." Version control exists for
just-in-case.

**Commented-out code** is zombie code. The only exception is a `// TODO:` or
a `// NOTE:` explaining a deliberate decision. A block of disabled code with no
explanation gets deleted.

---

## 3. Reuse Before You Write

Before writing a new function, component, or utility, check whether one already
exists that can reasonably do the job.

**The check before writing anything new:**
1. Does this logic already exist in `lib/`?
2. Does this component already exist in `components/` or the route's `_components/`?
3. Does this TypeScript interface already exist in `types/`?
4. Does this API route already exist in `app/api/`?

If yes: use it, import it, extend it if necessary. Do not write a parallel version.

**What "reasonably" means:** If using the existing function requires a small change
or an extra parameter, make that change. If it would require gutting the function to
the point where it becomes unrecognizable, then a new one is justified — but document
why.

**Interfaces especially:** A TypeScript interface for a DB shape is defined once in
`types/` and imported everywhere. Never redefine `BookingRecord`, `ScheduleSession`,
or any other shared type inline in a component file. Check `types/` first.

---

## 4. Security Review

Every file you write or modify must be considered through a security lens before
you finish. This is not optional — it is part of the definition of done for every task.

### What to look for

Examine your code for any of the following. This list is not exhaustive — use judgment.

**Authentication & Authorization**
- Endpoints that perform sensitive actions without verifying the caller's identity
- Role checks that can be bypassed (e.g. checking role client-side only)
- Admin routes accessible to non-admin roles
- Missing `archived` or `deactivated` checks that allow blocked accounts through

**Input & Data**
- User-supplied input used in database queries without validation (SQL injection risk)
- User-supplied input rendered as HTML without sanitization (XSS risk)
- File uploads that don't validate type, size, or content
- API endpoints that accept and use arbitrary fields from the request body

**Secrets & Credentials**
- Environment variables referenced in client-side code that should be server-only
- API keys, tokens, or secrets that could be exposed in logs, error messages, or responses
- OAuth tokens stored or transmitted insecurely

**Business Logic**
- Operations that can be repeated to cause unintended effects (double charge, double booking)
- Ownership checks missing — can user A access or modify user B's data?
- Amounts or quantities that come from the client and are trusted without server-side verification
- Webhook handlers that don't verify the payload came from the expected source

**Infrastructure**
- S3 URLs or file paths that expose internal structure or allow traversal
- Error messages that leak stack traces, table names, or internal logic to the client
- Rate limiting absent on public-facing endpoints that could be abused

---

### How to log a threat

When you identify a reasonable vulnerability, you must:

1. **Log it in `Building/threats.md`** using the format defined in that file
2. **Assign a threat level from 0–10:**
   - 0–3: Low — minor issue, low exploitability or low impact
   - 4–6: Medium — should be fixed before launch
   - 7–10: High — must be fixed, do not proceed past this task
3. **If the threat level is 7 or above**, stop and alert the user immediately with this message:

```
⚠️ SECURITY ALERT — Threat Level [X]/10

A high-severity vulnerability was identified in [file].

Threat: [one sentence description]
Attack vector: [how it could be exploited]

This has been logged in Building/threats.md as THREAT-[NNN].
This should be resolved before continuing development.
```

4. **If the threat level is 6 or below**, log it silently and continue. The user
   reviews `Building/threats.md` at their own cadence.

---

### What counts as "reasonable"

Do not log theoretical or highly improbable vulnerabilities. A threat is reasonable if:
- It could be exploited by a motivated attacker with basic knowledge
- It involves real data, real money, or real user accounts in this application
- The attack vector is realistic given how the application is used

Do not log: SSL/TLS configuration, OS-level hardening, third-party library CVEs,
or anything outside the application code itself. Those are infrastructure concerns.

---

### Security is not a separate pass

Do not finish writing a file and then review it for security afterward as a separate
step. Consider security as you write. If you're about to write an endpoint that
accepts user input — think about validation before you write it, not after.

---

## 5. Task Summary

After completing any task — a page, a component, an API route, or a group of related
files — always end your response with a plain English summary of what you just did.

**Format:**

```
---
Done. Here's what was built:

[2–5 sentences. No jargon. No bullet lists. Write it as if explaining to someone
who isn't a developer — what exists now that didn't before, what it does, and
anything they should be aware of before moving on.]
```

**Rules:**
- Plain English only. No technical terms unless unavoidable, and if used, explain them.
- No bullet lists. Write in sentences.
- Keep it short — 2 to 5 sentences maximum.
- Focus on what the user can now DO, not what code was written.
- If any TODOs were left or anything needs follow-up, mention it here.
- If a security threat was logged at level 6 or below during this task, mention it
  briefly: "One low/medium security note was logged in Building/threats.md."

**Example — good:**
```
Done. Here's what was built:

The schedule page now shows all upcoming approved classes, grouped by date. Customers
can filter by class type or date range using the buttons at the top. Each class card
shows the time, location, price, and how many spots are left — and the Book Now button
takes them straight to checkout for that class. One medium security note was logged
in Building/threats.md.
```

**Example — bad:**
```
Done. Here's what was built:

Implemented ScheduleClient.tsx as a client component with useState hooks for filter
state. Server-side data fetching in page.tsx using Supabase with approval_status
and active filters applied. Spots remaining computed from bookings join.
```

The bad example describes code. The good example describes what the user has.

---

## The Four-Question Check

Before writing any new code — function, component, type, or route — ask:

1. **Is this documented?** Will a human understand it without asking me?
2. **Does this make something else obsolete?** If yes, have I deleted that thing?
3. **Does this already exist?** Am I about to write a duplicate?
4. **Is this secure?** Have I considered the attack surface of what I just wrote?

If you can answer all four correctly, write the code.
If you cannot, fix the gap before proceeding.
