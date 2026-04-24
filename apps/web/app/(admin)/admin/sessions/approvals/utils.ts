/**
 * Shared utilities for the session approvals page.
 * Used by: ResubmissionsSection, NewSubmissionsSection
 */

/**
 * Returns a human-readable string describing how long a session has been waiting.
 * Based on the session's `updated_at` timestamp.
 * @param submittedAt - ISO 8601 date string (updated_at from class_sessions)
 * @returns e.g. "Less than 1 hour", "3 hours", "2 days"
 */
export function getWaitTime(submittedAt: string): string {
  const now = new Date();
  const submitted = new Date(submittedAt);
  const hours = Math.floor(
    (now.getTime() - submitted.getTime()) / (1000 * 60 * 60)
  );
  if (hours < 1) return "Less than 1 hour";
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""}`;
}

/**
 * Returns true if a session has been waiting more than 24 hours.
 * Used to trigger amber styling and the AlertTriangle icon on new submissions.
 * @param submittedAt - ISO 8601 date string (updated_at from class_sessions)
 */
export function isWaitOver24Hours(submittedAt: string): boolean {
  const hours =
    (Date.now() - new Date(submittedAt).getTime()) / (1000 * 60 * 60);
  return hours >= 24;
}
