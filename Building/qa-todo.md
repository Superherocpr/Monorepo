# QA Todo

Tested against local dev server `http://localhost:3001` in `apps/web`.

## Fixed ✅

1. ✅ **TypeScript build error** — `InstructorTeamSection.tsx` and `LeadInstructorSection.tsx` both had implicit `any` on `.map((c) => c.trim())` — fixed with explicit `(c: string)`.

2. ✅ **Lint errors** — All 40 issues resolved: unescaped apostrophes replaced with `&apos;`, set-state-in-effect errors fixed with lazy `useState` initializers, unused variables removed, `<img>` elements converted to `<Image>`. ESLint config updated to honor `_`-prefix unused-variable convention.

3. ✅ **Classes page `/schedule` link** — Changed to `/book` in `ClassesCtaSection.tsx`.

4. ✅ **Rollcall `/book/forgot-password` 404** — Created `/book/forgot-password/page.tsx` (sends reset email) and `/book/reset-password/page.tsx` (handles recovery token, redirects to `/dashboard`).

5. ✅ **Invoice create `/admin/settings/payment` link** — Changed to `/admin/profile/payment` in `invoices/new/page.tsx`.

6. ✅ **Sessions `/admin/sessions/new` 404** — Created `admin/sessions/new/page.tsx`, `_components/CreateSessionClient.tsx`, and `api/sessions/route.ts`. The form supports class type, location, instructor (manager/super admin only), date, time, duration, capacity, and notes. Submits for approval on save.

7. ✅ **Contact form empty-submit** — Added client-side validation at top of `handleSubmit` in `ContactSection.tsx`.

## Blocked or Not Code-Fixable

1. **Admin login credentials** — `danny@superherocpr.com / TestPass123!` failed on staging. This is a data/environment issue, not a code bug.

2. **PayPal client ID** — `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is blank in local environment. PayPal buttons will not render until this env var is set. No code change needed.

3. **Rollcall access code** — Seeded code `234567` may no longer match because the daily-code cron runs on staging. Test with a current instructor code from the DB.

## Working in This Pass (from QA crawl)

1. Public page loads passed for `/`, `/classes`, `/merch`, `/about`, `/contact`, `/signin`, `/book`, `/rollcall`, `/submit-roster`, `/setup-password`, `/email-previews`, and an invalid `/roster/[token]` URL.

2. Protected dashboard and admin URLs redirect unauthenticated visitors to sign-in.

3. Customer login works for `james.smith1@test.superherocpr.local` with `TestPass123!`.

4. Customer dashboard pages load after sign-in: dashboard, bookings, certifications, orders, and account settings.

5. Mobile navigation opens and closes correctly.

6. All Classes FAQ accordion buttons open correctly.

7. Submit roster invoice lookup handles empty input, an invalid invoice number, and the seeded invoice `INV-2025-0007`.

8. Customer account settings controls work for dirty-state detection, enabling Save Changes after edits, showing and canceling delete confirmation, and signing out.

9. Merch size selection, add-to-cart, cart drawer, cart quantity controls, and checkout-form reveal work before the PayPal step.

10. Booking class selection and customer sign-in handoff work up to the payment page.

## Not Safely Tested

1. Admin feature-by-feature and button-by-button testing is blocked by the failing seeded admin login.

2. Real PayPal payment approval, order confirmation, and booking confirmation are blocked by the blank PayPal client ID.

3. Contact form successful submission was not tested because it would create a real contact submission and may send email depending on environment settings.

4. Account deletion was not completed intentionally; only the confirmation and cancel controls were tested.

5. Roster file upload/submit was not completed intentionally; only invoice lookup was tested.

6. Setup-password success flow was not tested because no valid setup token was available.

## Working in This Pass

1. Public page loads passed for `/`, `/classes`, `/merch`, `/about`, `/contact`, `/signin`, `/book`, `/rollcall`, `/submit-roster`, `/setup-password`, `/email-previews`, and an invalid `/roster/[token]` URL.

2. Protected dashboard and admin URLs redirect unauthenticated visitors to sign-in.

3. Customer login works for `james.smith1@test.superherocpr.local` with `TestPass123!`.

4. Customer dashboard pages load after sign-in: dashboard, bookings, certifications, orders, and account settings.

5. Mobile navigation opens and closes correctly.

6. All Classes FAQ accordion buttons open correctly.

7. Submit roster invoice lookup handles empty input, an invalid invoice number, and the seeded invoice `INV-2025-0007`.

8. Customer account settings controls work for dirty-state detection, enabling Save Changes after edits, showing and canceling delete confirmation, and signing out.

9. Merch size selection, add-to-cart, cart drawer, cart quantity controls, and checkout-form reveal work before the PayPal step.

10. Booking class selection and customer sign-in handoff work up to the payment page.

## Blocked or Not Safely Tested

1. Admin feature-by-feature and button-by-button testing is blocked by the failing seeded admin login.

2. Real PayPal payment approval, order confirmation, and booking confirmation are blocked by the blank PayPal client ID.

3. Contact form successful submission was not tested because it would create a real contact submission and may send email depending on environment settings.

4. Account deletion was not completed intentionally; only the confirmation and cancel controls were tested.

5. Roster file upload/submit was not completed intentionally; only invoice lookup was tested.

6. Setup-password success flow was not tested because no valid setup token was available.