/**
 * Canonical inquiry type values for the contact form system.
 *
 * These are the exact strings stored in contact_submissions.inquiry_type.
 * They are used by:
 *   - The public /contact page dropdown (ContactSection.tsx)
 *   - The admin submissions filter (ContactSubmissionsClient.tsx)
 *   - Server-side input validation (app/api/contact/route.ts via admin/contact/page.tsx)
 *
 * To add or rename a type, edit this file only — all three consumers update automatically.
 * Note: a DB migration may be needed to backfill any renamed values in existing rows.
 */
export const CONTACT_INQUIRY_TYPES = [
  "Instructor",
  "General Question",
  "Group Booking (5+ people)",
  "Corporate / Workplace Training",
  "Certification Renewal",
  "Booking Inquiry",
  "Other",
] as const;

/** TypeScript union of all valid inquiry type strings. */
export type ContactInquiryType = (typeof CONTACT_INQUIRY_TYPES)[number];

/**
 * Resolves the `?inquiry=` query param on /contact to a canonical inquiry type,
 * so a link (e.g. the home page "Become an Instructor" button) can preselect it.
 * Case-insensitive; returns null for a missing or unrecognized value.
 * @param param - raw value of the `inquiry` query param.
 */
export function inquiryTypeFromParam(
  param: string | null | undefined
): ContactInquiryType | null {
  const wanted = param?.trim().toLowerCase();
  if (!wanted) return null;
  return CONTACT_INQUIRY_TYPES.find((t) => t.toLowerCase() === wanted) ?? null;
}

/**
 * The business inbox that customer-originated notifications are delivered to —
 * contact form submissions, merch orders, and roster uploads.
 *
 * Overridable via the CONTACT_EMAIL environment variable so the destination can
 * change without a deploy; the default preserves the address these routes used
 * when it was hardcoded at each call site.
 *
 * Deliberately NOT reusing OWNER_EMAILS from lib/constants.ts: that list answers
 * "who is an owner" for authorization checks, and wiring mail delivery to it
 * would mean editing the owner list silently re-routed the business inbox.
 */
export const BUSINESS_CONTACT_EMAIL: string =
  process.env.CONTACT_EMAIL?.trim() || "contact@superherocpr.com";
