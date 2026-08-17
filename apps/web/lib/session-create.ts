/**
 * session-create.ts — shared class-session creation logic.
 *
 * Extracted so that both the plain staff form (POST /api/sessions) and the
 * team/corporate booking flow (POST /api/team-bookings) validate foreign keys,
 * check add-on eligibility, and insert the class_sessions row through exactly
 * the same code path — so the two can never drift out of sync.
 *
 * Callers remain responsible for auth, JSON parsing, and type-guarding the raw
 * request body; this module takes already-typed params and has no knowledge of
 * Request/Response. Same split as lib/invoice-actions.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, "public", any>;

/** Fully-typed, caller-validated inputs for creating a class session. */
export interface CreateClassSessionParams {
  classTypeId: string;
  /** Resolved server-side — never taken straight from the client for instructors. */
  instructorId: string;
  locationId: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  /** ISO 8601 UTC. Must be after startsAt (caller validates). */
  endsAt: string;
  maxCapacity: number;
  /** Instructor-level discount 0–50, or null for none. */
  discountPercent: number | null;
  notes?: string | null;
  /** Add-on ids to offer on this session. Each is checked against addon_class_types. */
  addonIds?: string[];
  /**
   * Skips the instructor existence/role lookup. Only pass true when the caller
   * already proved the instructor is the authenticated staff member themselves.
   */
  skipInstructorCheck?: boolean;
  /**
   * Hides the session from /book, /schedule, and the anon RLS read policy.
   * Used for team/corporate sessions, which are reachable only via their link.
   */
  isPrivate?: boolean;
  /**
   * Creates the session already approved instead of pending_approval.
   * Only for manager/super-admin-created team bookings, so the share link is
   * live immediately — book_spot rejects signups on unapproved sessions.
   */
  autoApprove?: boolean;
}

export type CreateClassSessionResult =
  | { success: true; sessionId: string }
  | { success: false; error: string; status: 400 | 500 };

/**
 * Validates foreign keys and add-on eligibility, then inserts a class_sessions
 * row and attaches the selected add-ons.
 * Side effects: INSERT into class_sessions and session_addons.
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param params - Caller-validated session fields.
 * @returns The new session id, or a user-safe error message and HTTP status.
 */
export async function createClassSession(
  adminClient: AnySupabaseClient,
  params: CreateClassSessionParams
): Promise<CreateClassSessionResult> {
  // ── Verify class_type exists and is active ───────────────────────────────
  const { data: classType } = await adminClient
    .from("class_types")
    .select("id")
    .eq("id", params.classTypeId)
    .eq("active", true)
    .single();

  if (!classType) {
    return { success: false, error: "Class type not found or inactive.", status: 400 };
  }

  // ── Validate add-on selection against this class type's eligibility ──────
  // Every submitted id must appear in addon_class_types for the chosen class
  // type — trusting the client's checklist alone would let a caller assign an
  // add-on that isn't actually eligible for this class.
  const resolvedAddonIds = [...new Set(params.addonIds ?? [])];

  if (resolvedAddonIds.length > 0) {
    const { data: eligible } = await adminClient
      .from("addon_class_types")
      .select("addon_id")
      .eq("class_type_id", params.classTypeId)
      .in("addon_id", resolvedAddonIds);

    const eligibleIds = new Set((eligible ?? []).map((e: { addon_id: string }) => e.addon_id));
    if (resolvedAddonIds.some((id) => !eligibleIds.has(id))) {
      return {
        success: false,
        error: "One or more selected add-ons are not eligible for this class type.",
        status: 400,
      };
    }
  }

  // ── Verify location exists ───────────────────────────────────────────────
  const { data: location } = await adminClient
    .from("locations")
    .select("id")
    .eq("id", params.locationId)
    .single();

  if (!location) {
    return { success: false, error: "Location not found.", status: 400 };
  }

  // ── Verify instructor exists and is an active staff member ───────────────
  // Skipped when the caller is an instructor creating for themselves, since
  // their own role was already established during authentication.
  if (!params.skipInstructorCheck) {
    const { data: instructor } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", params.instructorId)
      .in("role", ["instructor", "manager", "super_admin"])
      .eq("deactivated", false)
      .single();

    if (!instructor) {
      return { success: false, error: "Instructor not found or inactive.", status: 400 };
    }
  }

  // ── Insert the new session ───────────────────────────────────────────────
  const { data: newSession, error: insertError } = await adminClient
    .from("class_sessions")
    .insert({
      class_type_id: params.classTypeId,
      instructor_id: params.instructorId,
      location_id: params.locationId,
      starts_at: params.startsAt,
      ends_at: params.endsAt,
      max_capacity: params.maxCapacity,
      discount_percent: params.discountPercent,
      // notes is optional — only set if truthy to avoid storing empty strings
      ...(typeof params.notes === "string" && params.notes.trim()
        ? { notes: params.notes.trim() }
        : {}),
      ...(params.isPrivate ? { is_private: true } : {}),
      ...(params.autoApprove ? { approval_status: "approved" } : {}),
      // Defaults set by DB: status = 'scheduled', approval_status = 'pending_approval'
    })
    .select("id")
    .single();

  if (insertError || !newSession) {
    console.error("[createClassSession] insert error:", insertError);
    return { success: false, error: "Failed to create session. Please try again.", status: 500 };
  }

  // ── Attach the selected add-ons to the new session ───────────────────────
  if (resolvedAddonIds.length > 0) {
    const { error: addonError } = await adminClient
      .from("session_addons")
      .insert(resolvedAddonIds.map((addon_id) => ({ session_id: newSession.id, addon_id })));

    if (addonError) {
      console.error("[createClassSession] session_addons insert error:", addonError);
      // Session was created successfully — don't fail the whole request over add-ons.
    }
  }

  return { success: true, sessionId: newSession.id as string };
}
