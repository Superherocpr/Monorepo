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
  "General Question",
  "Group Booking (5+ people)",
  "Corporate / Workplace Training",
  "Certification Renewal",
  "Booking Inquiry",
  "Hiring",
  "Other",
] as const;

/** TypeScript union of all valid inquiry type strings. */
export type ContactInquiryType = (typeof CONTACT_INQUIRY_TYPES)[number];
