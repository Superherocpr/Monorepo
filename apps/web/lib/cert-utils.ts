/**
 * Shared utilities for certification status display and URL slugs.
 * Imported by:
 *   - app/(public)/dashboard/_components/CertificationsWidget.tsx
 *   - app/(public)/dashboard/certifications/_components/ActiveCertificationsList.tsx
 *   - app/(public)/dashboard/certifications/_components/ExpiredCertificationsList.tsx
 *
 * Do not duplicate this logic — always import from here.
 */

/**
 * Returns a display label and color for a certification's expiry status.
 * Color is one of 'green' | 'amber' | 'red' — use to select Tailwind classes.
 * @param expiresAt - ISO date string of the certification's expiry date
 */
export function getCertStatus(expiresAt: string): {
  label: string;
  color: "green" | "amber" | "red";
} {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const daysRemaining = Math.ceil(
    (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysRemaining < 0) {
    return { label: "Expired", color: "red" };
  }
  if (daysRemaining <= 90) {
    return {
      label: `Expires in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`,
      color: "amber",
    };
  }
  return {
    label: `Expires ${new Date(expiresAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`,
    color: "green",
  };
}

/**
 * Converts a certification type name to a URL-safe slug for booking renewal links.
 * e.g. "BLS for Healthcare Providers" → "bls-for-healthcare-providers"
 * @param className - The cert type name string
 */
export function getClassSlug(className: string): string {
  return className.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
