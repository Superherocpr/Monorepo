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

/**
 * How a class request's venue was specified.
 * `customer_venue`: a freeform address the customer typed in — approval
 * creates a new `locations` row from it.
 * `home_base`: an existing `locations` row (is_home_base = true) picked from
 * a dropdown — approval reuses it, and no travel fee applies.
 */
export type VenueMode = "customer_venue" | "home_base";

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
  venue_mode: VenueMode;
  /** Set only when venue_mode = "home_base". */
  venue_location_id: string | null;
  /** Null when venue_mode = "home_base" — the address is on the linked location instead. */
  venue_name: string | null;
  venue_address: string | null;
  /** Always populated in both modes — customer input, or copied from the chosen home base. */
  venue_city: string;
  venue_state: string;
  venue_zip: string | null;
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

/** Fields common to both venue shapes of a new class request. */
interface CreateClassRequestBodyBase {
  class_type_id: string;
  preferred_date: string;
  preferred_time_of_day: PreferredTimeOfDay;
  group_size: number;
  contact_phone: string;
  notes?: string;
}

/** A freeform venue the customer typed in themselves. */
export interface CustomerVenueRequestBody extends CreateClassRequestBodyBase {
  venue_mode: "customer_venue";
  venue_name: string;
  venue_address: string;
  venue_city: string;
  venue_state: string;
  venue_zip: string;
}

/** One of our existing home-base locations, picked by id. No travel fee. */
export interface HomeBaseRequestBody extends CreateClassRequestBodyBase {
  venue_mode: "home_base";
  venue_location_id: string;
}

/** Payload for creating a new class request (POST /api/class-requests). */
export type CreateClassRequestBody = CustomerVenueRequestBody | HomeBaseRequestBody;
