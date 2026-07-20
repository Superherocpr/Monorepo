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

  // ── Verify class_type exists and is active ─────────────────────────────────
  const { data: classType } = await adminClient
    .from("class_types")
    .select("id")
    .eq("id", class_type_id)
    .eq("active", true)
    .single();

  if (!classType) {
    return NextResponse.json(
      { error: "Class type not found or inactive." },
      { status: 400 }
    );
  }

  // ── Validate add-on selection against this class type's eligibility ────────
  // addon_ids is optional. Every submitted id must appear in addon_class_types
  // for the chosen class_type_id — trusting the client's checklist alone would
  // let a caller assign an add-on that isn't actually eligible for this class.
  let resolvedAddonIds: string[] = [];
  if (addon_ids !== undefined) {
    if (
      !Array.isArray(addon_ids) ||
      !addon_ids.every((id) => typeof id === "string")
    ) {
      return NextResponse.json({ error: "addon_ids must be an array of strings." }, { status: 400 });
    }
    resolvedAddonIds = [...new Set(addon_ids as string[])];

    if (resolvedAddonIds.length > 0) {
      const { data: eligible } = await adminClient
        .from("addon_class_types")
        .select("addon_id")
        .eq("class_type_id", class_type_id)
        .in("addon_id", resolvedAddonIds);

      const eligibleIds = new Set((eligible ?? []).map((e) => e.addon_id));
      if (resolvedAddonIds.some((id) => !eligibleIds.has(id))) {
        return NextResponse.json(
          { error: "One or more selected add-ons are not eligible for this class type." },
          { status: 400 }
        );
      }
    }
  }

  // ── Verify location exists ─────────────────────────────────────────────────
  const { data: location } = await adminClient
    .from("locations")
    .select("id")
    .eq("id", location_id)
    .single();

  if (!location) {
    return NextResponse.json(
      { error: "Location not found." },
      { status: 400 }
    );
  }

  // ── Verify instructor exists and is a staff member ─────────────────────────
  // Only check if a non-instructor user supplied an instructor_id.
  if (!isInstructor) {
    const { data: instructor } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", resolvedInstructorId)
      .in("role", ["instructor", "manager", "super_admin"])
      .eq("deactivated", false)
      .single();

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found or inactive." },
        { status: 400 }
      );
    }
  }

  // ── Insert the new session ─────────────────────────────────────────────────
  const { data: newSession, error: insertError } = await adminClient
    .from("class_sessions")
    .insert({
      class_type_id,
      instructor_id: resolvedInstructorId,
      location_id,
      starts_at,
      ends_at,
      max_capacity,
      discount_percent: resolvedDiscount,
      // notes is optional — only set if truthy to avoid storing empty strings
      ...(typeof notes === "string" && notes.trim() ? { notes: notes.trim() } : {}),
      // Defaults set by DB: status = 'scheduled', approval_status = 'pending_approval'
    })
    .select("id")
    .single();

  if (insertError || !newSession) {
    console.error("[POST /api/sessions] insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create session. Please try again." },
      { status: 500 }
    );
  }

  // ── Attach the selected add-ons to the new session ──────────────────────────
  if (resolvedAddonIds.length > 0) {
    const { error: addonError } = await adminClient
      .from("session_addons")
      .insert(resolvedAddonIds.map((addon_id) => ({ session_id: newSession.id, addon_id })));

    if (addonError) {
      console.error("[POST /api/sessions] session_addons insert error:", addonError);
      // Session was created successfully — don't fail the whole request over add-ons.
    }
  }

  return NextResponse.json({ id: newSession.id }, { status: 201 });
}
