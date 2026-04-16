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

## The Three-Question Check

Before writing any new code — function, component, type, or route — ask:

1. **Is this documented?** Will a human understand it without asking me?
2. **Does this make something else obsolete?** If yes, have I deleted that thing?
3. **Does this already exist?** Am I about to write a duplicate?

If you can answer all three correctly, write the code.
If you cannot, fix the gap before proceeding.
