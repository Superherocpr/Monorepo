/**
 * Application-wide constants.
 * Import from here rather than hardcoding values in components or API routes.
 */

/**
 * The business owner's email address.
 * This account is protected: its role cannot be changed and it cannot be
 * deactivated via the UI or any API route.
 */
// Comma-separated list of owner emails — all are protected from deactivation and role changes.
// Example: OWNER_EMAIL=owner1@example.com,owner2@example.com
export const OWNER_EMAILS: string[] = (process.env.OWNER_EMAIL ?? "contact@superherocpr.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Direct phone number for Daniel Hedgeman, shown to instructors who are
 * blocked from cancelling a class online because it starts within 48 hours.
 */
export const OWNER_DIRECT_PHONE = "(813) 966-3969";
