/**
 * Pure logic for the staff "What's New" changelog: version comparison, role
 * filtering, release grouping, and unread detection.
 * Entries live in content/changelog.ts. The server-side loader (lib/whats-new.ts)
 * and the admin layout, sidebar and /admin/whats-new page build on these.
 */

import type { UserRole } from "@/types/users";
import type { ChangelogEntry, ChangelogRelease } from "@/types/changelog";

/**
 * Splits a "major.minor.patch" version into numbers.
 * @param version - A version string such as "1.7.0".
 * @returns The three numeric parts, or null when the string is not a plain semver.
 */
export function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Orders two versions numerically, so "1.10.0" sorts after "1.9.0" (a string
 * compare gets that wrong).
 * @param a - First version.
 * @param b - Second version.
 * @returns Negative when a is older than b, positive when newer, 0 when equal.
 *          An unparseable version sorts as the oldest possible.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [-1, -1, -1];
  const pb = parseVersion(b) ?? [-1, -1, -1];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * The newest version that has at least one entry.
 * @param entries - The full changelog.
 * @returns The highest version, or null for an empty changelog.
 */
export function latestVersion(entries: readonly ChangelogEntry[]): string | null {
  let latest: string | null = null;
  for (const entry of entries) {
    if (latest === null || compareVersions(entry.version, latest) > 0) latest = entry.version;
  }
  return latest;
}

/**
 * Stable identity for an entry: its version plus its title (titles are unique
 * within a version; the changelog test enforces it).
 * @param entry - The entry.
 * @returns A key safe to use as a React key and in a Set.
 */
export function entryKey(entry: ChangelogEntry): string {
  return `${entry.version}|${entry.title}`;
}

/**
 * Entries one role is allowed to see.
 * @param entries - The full changelog.
 * @param role - The viewer's effective role.
 * @returns Entries with no `roles` list (everyone) or whose list includes the role.
 */
export function entriesForRole(
  entries: readonly ChangelogEntry[],
  role: UserRole
): ChangelogEntry[] {
  return entries.filter((entry) => !entry.roles || entry.roles.includes(role));
}

/**
 * Groups entries into releases, newest version first. Entry order within a
 * release is preserved so authors control the reading order.
 * @param entries - Entries to group (already role-filtered).
 * @returns One release per distinct version.
 */
export function groupByRelease(entries: readonly ChangelogEntry[]): ChangelogRelease[] {
  const byVersion = new Map<string, ChangelogRelease>();
  for (const entry of entries) {
    const release = byVersion.get(entry.version);
    if (release) {
      release.entries.push(entry);
    } else {
      byVersion.set(entry.version, { version: entry.version, date: entry.date, entries: [entry] });
    }
  }
  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Which entries a person has not seen yet.
 *
 * Normal case: anything newer than the version they last saw. A person who has
 * never opened What's New (seenVersion null) has no baseline, so anything
 * released after their account was created counts as unread and anything
 * released before it does not. That keeps a new hire from starting with the
 * whole history flagged as new.
 * @param entries - Entries already filtered to the viewer's role.
 * @param seenVersion - profiles.whats_new_seen_version, or null.
 * @param accountCreatedAt - profiles.created_at (ISO timestamp), used only when seenVersion is null.
 * @returns The unread entries.
 */
export function unreadEntries(
  entries: readonly ChangelogEntry[],
  seenVersion: string | null,
  accountCreatedAt: string | null
): ChangelogEntry[] {
  if (seenVersion) return entries.filter((e) => compareVersions(e.version, seenVersion) > 0);
  if (!accountCreatedAt) return [];
  // Both sides are YYYY-MM-DD, which orders correctly as plain strings.
  const createdDate = accountCreatedAt.slice(0, 10);
  return entries.filter((e) => e.date > createdDate);
}

/**
 * Formats a release date such as "October 15, 2026".
 * @param date - A calendar date, YYYY-MM-DD.
 * @returns The long English date. Read as UTC on purpose: a release date is a
 *          calendar day, not a moment, so it must not shift with the viewer's
 *          time zone (unlike class times, which use lib/business-time.ts).
 */
export function formatReleaseDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
