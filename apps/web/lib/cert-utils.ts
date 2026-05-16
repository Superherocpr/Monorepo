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

/**
 * Maps every known AHA cert type name (as stored in cert_types.name) to its
 * official AHA brand color, category header text, and two-line name display
 * matching the layout of physical AHA eCards (brand on top, course below).
 *
 * displayName is the full program name (no " eCard" suffix) used in body text.
 * nameLine1 / nameLine2 are the two visually separate lines shown in the card header area.
 *
 * Used exclusively by AHACertCard to drive the colored header and cert label.
 * If an unknown cert name is passed, returns a neutral dark fallback.
 *
 * @param name - The cert_types.name value from the database
 */
const CERT_CONFIGS: Record<
  string,
  { category: string; color: string; nameLine1: string; nameLine2: string }
> = {
  "Heartsaver® First Aid eCard":                  { category: "HEARTSAVER", color: "#002F6C", nameLine1: "Heartsaver®",  nameLine2: "First Aid" },
  "Heartsaver® CPR AED eCard":                    { category: "HEARTSAVER", color: "#002F6C", nameLine1: "Heartsaver®",  nameLine2: "CPR AED" },
  "Heartsaver® First Aid CPR AED eCard":          { category: "HEARTSAVER", color: "#002F6C", nameLine1: "Heartsaver®",  nameLine2: "First Aid CPR AED" },
  "Heartsaver® Pediatric First Aid CPR AED eCard":{ category: "HEARTSAVER", color: "#002F6C", nameLine1: "Heartsaver®",  nameLine2: "Pediatric First Aid CPR AED" },
  "Heartsaver® Instructor eCard":                 { category: "HEARTSAVER", color: "#002F6C", nameLine1: "Heartsaver®",  nameLine2: "Instructor" },
  "Advisor: BLS eCard":                           { category: "BLS",        color: "#4086CA", nameLine1: "Advisor:",      nameLine2: "BLS" },
  "BLS Provider eCard":                           { category: "BLS",        color: "#4086CA", nameLine1: "BLS",           nameLine2: "Provider" },
  "BLS Instructor eCard":                         { category: "BLS",        color: "#4086CA", nameLine1: "BLS",           nameLine2: "Instructor" },
  "ACLS Provider eCard":                          { category: "ACLS",       color: "#D12F36", nameLine1: "ACLS",          nameLine2: "Provider" },
  "ACLS Instructor eCard":                        { category: "ACLS",       color: "#D12F36", nameLine1: "ACLS",          nameLine2: "Instructor" },
  "PALS Provider eCard":                          { category: "PALS",       color: "#5F249F", nameLine1: "PALS",          nameLine2: "Provider" },
  "PALS Instructor eCard":                        { category: "PALS",       color: "#5F249F", nameLine1: "PALS",          nameLine2: "Instructor" },
  "Heartsaver® for K-12 Schools eCard":           { category: "HEARTSAVER", color: "#00953B", nameLine1: "Heartsaver®",  nameLine2: "for K-12 Schools" },
};

export function getCertConfig(name: string): {
  category: string;
  color: string;
  /** Full program name with " eCard" stripped — used in the body paragraph. */
  displayName: string;
  /** First line of the card's name block — the brand or acronym (e.g. "Heartsaver®", "BLS"). */
  nameLine1: string;
  /** Second line of the card's name block — the course type (e.g. "First Aid", "Provider"). */
  nameLine2: string;
} {
  const config = CERT_CONFIGS[name] ?? { category: "CERTIFICATION", color: "#1A1919", nameLine1: name.replace(/ eCard$/, ""), nameLine2: "" };
  return {
    ...config,
    // Strip the " eCard" suffix — the card displays the program name, not the DB label
    displayName: name.replace(/ eCard$/, ""),
  };
}
