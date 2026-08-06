/**
 * types/class-requests.ts
 * TypeScript types for the customer-requested class feature.
 */

/** Valid values for the preferred time of day on a class request. */
export type PreferredTimeOfDay = "morning" | "afternoon" | "evening" | "flexible";

/** Human-readable labels for each time of day option. */
export const PREFERRED_TIME_LABELS: Record<PreferredTimeOfDay, string> = {
  morning: "Morning (before noon)",
  afternoon: "Afternoon (12pm – 5pm)",
  evening: "Evening (after 5pm)",
  flexible: "Flexible / No preference",
};

/** Valid status values for a class request. */
export type ClassRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "instructor_assigned";

/** Human-readable labels for each class request status. */
export const CLASS_REQUEST_STATUS_LABELS: Record<ClassRequestStatus, string> = {
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
  instructor_assigned: "Instructor Assigned",
};

/**
 * A class_requests row as returned by the API, with joined class type and
 * customer profile data.
 */
export interface ClassRequest {
  id: string;
  customer_id: string;
  class_type_id: string;
  preferred_date: string;
  preferred_time_of_day: PreferredTimeOfDay;
  group_size: number;
  venue_name: string;
  venue_address: string;
  venue_city: string;
  venue_state: string;
  venue_zip: string;
  notes: string | null;
  status: ClassRequestStatus;
  rejection_reason: string | null;
  travel_fee: number;
  session_id: string | null;
  created_at: string;
  /** Joined class type data. */
  class_types: { id: string; name: string; duration_minutes: number; price: number } | null;
  /** Contact phone number provided with the request (nullable for legacy rows). */
  contact_phone: string | null;
  /** Joined customer profile data. */
  profiles: { id: string; first_name: string; last_name: string; email: string } | null;
}

/** Payload for creating a new class request (POST /api/class-requests). */
export interface CreateClassRequestBody {
  class_type_id: string;
  preferred_date: string;
  preferred_time_of_day: PreferredTimeOfDay;
  group_size: number;
  contact_phone: string;
  venue_name: string;
  venue_address: string;
  venue_city: string;
  venue_state: string;
  venue_zip: string;
  notes?: string;
}
