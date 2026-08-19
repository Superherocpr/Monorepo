/**
 * POST /api/sessions
 * Called by: CreateSessionClient (admin sessions/new form)
 * Auth: Instructor, Manager, or Super Admin
 *
 * Creates a new class session by:
 * 1. Verifying the caller is an authenticated staff member
 * 2. Validating all required fields
 * 3. Checking that class_type, location, and instructor exist and are valid
 * 4. Inserting the new class_sessions record (approval_status defaults to pending_approval)
 * 5. Returning the new session id for redirect
 *
 * Instructors may only create sessions for themselves.
 * Managers and super admins may create sessions for any instructor.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createClassSession } from "@/lib/session-create";
import { NextResponse } from "next/server";

/** Staff roles that are permitted to create sessions. */
const ALLOWED_ROLES = ["instructor", "manager", "super_admin"] as const;

/**
 * Handles POST requests to create a new class session.
 * Validates input, checks FK references, and inserts the record.
 * @param request - Incoming Next.js API request.
 * @returns JSON with `{ id }` on success, or an error message and status code.
 */
export async function POST(request: Request): Promise<Response> {
  // ── Auth (honors view-as: a downgraded super admin creates as instructor) ──
  const authResult = await requireApiRole([...ALLOWED_ROLES]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const isInstructor = actor.effectiveRole === "instructor";

  const adminClient = await createAdminClient();

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    class_type_id,
    instructor_id,
    location_id,
    starts_at,
    ends_at,
    max_capacity,
    notes,
    discount_percent,
    addon_ids,
  } = body as Record<string, unknown>;

  // ── Validate required fields ───────────────────────────────────────────────
  if (
    typeof class_type_id !== "string" || !class_type_id ||
    typeof location_id !== "string" || !location_id ||
    typeof starts_at !== "string" || !starts_at ||
    typeof ends_at !== "string" || !ends_at ||
    typeof max_capacity !== "number" || max_capacity < 1
  ) {
    return NextResponse.json(
      { error: "Missing or invalid required fields." },
      { status: 400 }
    );
  }

  // Instructors are always their own instructor — reject attempts to impersonate.
  // Managers/super admins must supply an instructor_id.
  const resolvedInstructorId = isInstructor
    ? actor.user.id
    : typeof instructor_id === "string" && instructor_id
    ? instructor_id
    : null;

  if (!resolvedInstructorId) {
    return NextResponse.json(
      { error: "instructor_id is required for manager and super admin." },
      { status: 400 }
    );
  }

  // ── Validate optional discount ─────────────────────────────────────────────
  // discount_percent must be omitted/null (no discount) or a number between 0 and 50.
  const hasDiscount = discount_percent !== null && discount_percent !== undefined;
  if (hasDiscount && (typeof discount_percent !== "number" || discount_percent < 0 || discount_percent > 50)) {
    return NextResponse.json(
      { error: "discount_percent must be a number between 0 and 50." },
      { status: 400 }
    );
  }
  const resolvedDiscount: number | null = hasDiscount ? (discount_percent as number) : null;

  // ── Validate timestamps ────────────────────────────────────────────────────
  const start = new Date(starts_at);
  const end = new Date(ends_at);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return NextResponse.json(
      { error: "ends_at must be after starts_at." },
      { status: 400 }
    );
  }

  // ── Validate add_on ids are well-formed before handing off ─────────────────
  // Eligibility itself is checked inside createClassSession; this only guards
  // the raw shape coming off the request body.
  if (
    addon_ids !== undefined &&
    (!Array.isArray(addon_ids) || !addon_ids.every((id) => typeof id === "string"))
  ) {
    return NextResponse.json({ error: "addon_ids must be an array of strings." }, { status: 400 });
  }

  // ── Create the session via the shared helper ───────────────────────────────
  // Shared with POST /api/team-bookings so FK validation, add-on eligibility,
  // and the insert can never drift between the two entry points.
  const result = await createClassSession(adminClient, {
    classTypeId: class_type_id,
    instructorId: resolvedInstructorId,
    locationId: location_id,
    startsAt: starts_at,
    endsAt: ends_at,
    maxCapacity: max_capacity,
    discountPercent: resolvedDiscount,
    notes: typeof notes === "string" ? notes : null,
    addonIds: addon_ids as string[] | undefined,
    // An instructor's own id came from their authenticated session, not the body.
    skipInstructorCheck: isInstructor,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ id: result.sessionId }, { status: 201 });
}
