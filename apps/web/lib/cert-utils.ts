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
/**
 * Parses a certification date string from the database into a local Date.
 * Certification dates are stored as `date` columns, not timestamps, so using
 * the built-in `Date("YYYY-MM-DD")` parser would treat them as UTC and shift
 * the day in some timezones.
 * @param dateStr - Stored certification date string (usually YYYY-MM-DD).
 * @returns The equivalent local Date instance.
 */
function parseCertificationDate(dateStr: string): Date {
  if (dateStr.includes("T")) {
    return new Date(dateStr);
  }

  const [year, month, day] = dateStr.split("-").map(Number);

  if (!year || !month || !day) {
    return new Date(dateStr);
  }

  return new Date(year, month - 1, day);
}

/**
 * Returns the exact moment a certification should stop being treated as active.
 * Date-only expiry values remain valid through the end of their calendar day.
 * @param expiresAt - Stored certification expiry date string.
 * @returns A local Date representing the certification's expiry cutoff.
 */
function getCertificationExpiryCutoff(expiresAt: string): Date {
  const expiry = parseCertificationDate(expiresAt);

  if (!expiresAt.includes("T")) {
    expiry.setHours(23, 59, 59, 999);
  }

  return expiry;
}

/**
 * Formats a stored certification date as a readable local calendar date.
 * @param dateStr - Stored certification date string.
 * @returns Display text like "April 1, 2024".
 */
export function formatCertificationDate(dateStr: string): string {
  return parseCertificationDate(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Returns how many days remain before a certification expires.
 * A certification is valid through the full expiry date, so date-only values
 * are measured against the end of that day.
 * @param expiresAt - Stored certification expiry date string.
 * @param now - Optional comparison point; defaults to the current time.
 * @returns Days remaining until expiry, negative when already expired.
 */
export function getCertificationDaysUntilExpiry(
  expiresAt: string,
  now: Date = new Date()
): number {
  const expiry = getCertificationExpiryCutoff(expiresAt);
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns whether a certification is still active.
 * @param expiresAt - Stored certification expiry date string.
 * @param now - Optional comparison point; defaults to the current time.
 * @returns True when the certification is valid at the given time.
 */
export function isCertificationActive(
  expiresAt: string,
  now: Date = new Date()
): boolean {
  return getCertificationExpiryCutoff(expiresAt).getTime() >= now.getTime();
}

/**
 * Returns whether a certification is active and due to expire soon.
 * @param expiresAt - Stored certification expiry date string.
 * @param now - Optional comparison point; defaults to the current time.
 * @param withinDays - Day threshold for "expiring soon".
 * @returns True when the certification is active and expires within the threshold.
 */
export function isCertificationExpiringSoon(
  expiresAt: string,
  now: Date = new Date(),
  withinDays: number = 90
): boolean {
  const daysRemaining = getCertificationDaysUntilExpiry(expiresAt, now);
  return daysRemaining >= 0 && daysRemaining <= withinDays;
}

/**
 * Returns a display label and color for a certification's expiry status.
 * Color is one of 'green' | 'amber' | 'red' — use to select Tailwind classes.
 * @param expiresAt - ISO date string of the certification's expiry date
 */
export function getCertStatus(expiresAt: string): {
  label: string;
  color: "green" | "amber" | "red";
} {
  const daysRemaining = getCertificationDaysUntilExpiry(expiresAt);

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
    label: `Expires ${formatCertificationDate(expiresAt)}`,
    color: "green",
  };
}

/**
 * Converts a certification type name to a URL-safe slug for booking renewal links.
 * e.g. "BLS Provider eCard" → strips " eCard" → "BLS Provider" → "bls-provider"
 * The " eCard" suffix is stripped so the slug matches the class_types.name in the
 * booking flow, which uses the same slugify logic without the " eCard" suffix.
 * @param className - The cert type name string (may include " eCard" suffix)
 */
export function getClassSlug(className: string): string {
  // Strip the AHA " eCard" suffix before slugifying so that cert names like
  // "BLS Provider eCard" produce "bls-provider", which matches the class type
  // slug generated by BookSessionSelector.tsx from "BLS Provider".
  return className.replace(/ eCard$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
export const CERT_CONFIGS: Record<
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
  "PEARS® Provider eCard":                         { category: "PEARS",      color: "#007A87", nameLine1: "PEARS®",       nameLine2: "Provider" },
  "PEARS® Instructor eCard":                       { category: "PEARS",      color: "#007A87", nameLine1: "PEARS®",       nameLine2: "Instructor" },
  "ACLS EP eCard":                                 { category: "ACLS EP",    color: "#D12F36", nameLine1: "ACLS EP",      nameLine2: "" },
  "ACLS EP Instructor eCard":                      { category: "ACLS EP",    color: "#D12F36", nameLine1: "ACLS EP",      nameLine2: "Instructor" },
  // SuperHeroCPR-branded cert — issued directly by SuperHeroCPR, not an AHA eCard
  "SuperHeroCPR Certificate":                      { category: "SUPERHEROCPR", color: "#dc2626", nameLine1: "SuperHero",  nameLine2: "CPR" },
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
