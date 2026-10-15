/**
 * TypeScript types for the staff "What's New" changelog.
 * Entries live in content/changelog.ts; the logic that reads them lives in lib/changelog.ts.
 */

import type { UserRole } from "@/types/users";

/** What kind of change an entry describes. Drives the badge shown beside the title. */
export type ChangelogKind = "new" | "improved" | "fixed";

/** One staff-facing change, written in plain English. */
export interface ChangelogEntry {
  /**
   * The app version that first shipped this change: the `version` in package.json
   * at the time it reached staging. Several entries can share one version.
   */
  version: string;
  /** Release date (YYYY-MM-DD). Every entry of one version carries the same date. */
  date: string;
  kind: ChangelogKind;
  /** Short headline. Must be unique within its version (it is half of the entry's key). */
  title: string;
  /** One to three plain-English sentences: what changed and what the reader can now do. */
  summary: string;
  /** Roles that see this entry. Omit for every staff role. */
  roles?: readonly UserRole[];
  /** Optional admin path to the feature, shown as a "Go to" link. */
  href?: string;
}

/** A group of entries released together under one version. */
export interface ChangelogRelease {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}
