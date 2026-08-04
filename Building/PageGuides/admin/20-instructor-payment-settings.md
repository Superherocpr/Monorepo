# Instructor Payout Settings Build Guide
**Route:** `/admin/profile/payment`
**File:** `app/(admin)/admin/profile/payment/page.tsx`

---

## Context

Instructors no longer connect payment platforms with OAuth. SuperHeroCPR collects customer payments through the business PayPal account, records instructor earnings, and sends instructor compensation through PayPal Payouts.

This page lets an instructor or super admin save the PayPal email address where payouts should be sent.

**Access control:** Instructor and Super Admin only.

---

## Data Fetching

```typescript
const { data: profile } = await supabase
  .from('profiles')
  .select('id, role, paypal_payout_email')
  .eq('id', user.id)
  .single()
```

Redirect unauthenticated users to `/signin?redirect=/admin/profile/payment`. Redirect any role other than `instructor` or `super_admin` to `/admin`.

---

## Page Behavior

- Heading: `Payout Settings`
- Field label: `PayPal payout email`
- Save action: `PATCH /api/profile/payout-email`
- Success state: show that the instructor is ready for payouts
- Empty state: explain that invoices require a payout email before they can be created

The form accepts a normal email address only. The server route is authoritative and must validate the email before updating `profiles.paypal_payout_email`.

---

## Related Rules

- Invoice creation is blocked for instructors missing `paypal_payout_email`.
- Super admins can view `/admin/payouts` to send and sync payout batches.
- No OAuth tokens are stored for instructors.
- No Square, Stripe, or Venmo Business connect buttons should exist.

---

## Definition of Done

- [ ] Access restricted to instructor and super admin
- [ ] Current payout email loads from `profiles.paypal_payout_email`
- [ ] Save validates and persists through `/api/profile/payout-email`
- [ ] Sidebar label reads `Payout Settings`
- [ ] Admin layout banner points instructors with no payout email to this page
- [ ] Invoice creation blocks instructors missing a payout email
- [ ] No OAuth connect buttons, token storage, or platform account UI remains
- [ ] No TypeScript errors
- [ ] No ESLint errors
