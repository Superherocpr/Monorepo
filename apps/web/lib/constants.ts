/**
 * Application-wide constants.
 * Import from here rather than hardcoding values in components or API routes.
 */

/**
 * The business owner's email address.
 * This account is protected: its role cannot be changed and it cannot be
 * deactivated via the UI or any API route.
 */
export const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "contact@superherocpr.com";
