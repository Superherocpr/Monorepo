/**
 * TypeScript interfaces for class/session-related database tables.
 * Covers: class_types, locations, class_sessions.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/**
 * A CPR course offering from the `class_types` table.
 * When active = false, hidden from public schedule, booking flow, and invoice creation.
 */
export interface ClassType {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  max_capacity: number;
  price: number;
  active: boolean;
  created_at: string;
}

/**
 * A class venue from the `locations` table.
 * Only one location may have is_home_base = true at a time.
 */
export interface Location {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string | null;
  is_home_base: boolean;
  created_at: string;
}

/** Status values for class_sessions.status enum. */
export type SessionStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

/** Approval status values for class_sessions.approval_status enum. */
export type SessionApprovalStatus =
  | "pending_approval"
  | "approved"
  | "rejected";

/**
 * A scheduled class session from the `class_sessions` table.
 * One session = one class on one date.
 */
export interface ClassSession {
  id: string;
  class_type_id: string;
  instructor_id: string;
  location_id: string;
  starts_at: string;
  ends_at: string;
  max_capacity: number;
  status: SessionStatus;
  approval_status: SessionApprovalStatus;
  rejection_reason: string | null;
  google_calendar_event_id: string | null;
  roster_imported: boolean;
  session_token: string | null;
  correction_window_closes_at: string | null;
  enrollware_submitted: boolean;
  notes: string | null;
  created_at: string;
}

/**
 * A class session with its related class_type and location joined in.
 * Used on the public schedule page and admin session list.
 */
export interface ClassSessionWithDetails extends ClassSession {
  class_types: ClassType;
  locations: Location;
}
