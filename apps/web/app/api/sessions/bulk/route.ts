/**
 * POST /api/sessions/bulk
 * Called by: BulkCreateSessionClient (admin sessions/bulk form)
 * Auth: Instructor, Manager, or Super Admin
 *
 * Accepts a shared class type, instructor, and location plus an array of
 * per-session payloads (timestamps, capacity, optional notes). Validates all
 * records then inserts them in a single DB operation — all succeed or none are
 * created. Returns { created, ids } on success.
 *
 * Instructors may only create sessions for themselves.
 * Managers and super admins may create sessions for any instructor.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Staff roles permitted to create sessions. */
const ALLOWED_ROLES = ["instructor", "manager", "super_admin"] as const;

/** Shape of each individual session entry in the request body. */
interface SessionEntry {
  starts_at: string;
  ends_at: string;
  max_capacity: number;
  notes?: string;
}

/**
 * Handles POST requests to bulk-create class sessions.
 * Validates shared fields, verifies FK references, then inserts all sessions
 * atomically. A failure at any step creates no sessions.
 * @param request - Incoming Next.js API request.
 * @returns JSON with `{ created, ids }` on success, or an error object.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();

  // ── Auth ───────────────────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isInstructor = profile.role === "instructor";
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

  const { class_type_id, instructor_id, location_id, sessions } =
    body as Record<string, unknown>;

  // ── Validate shared fields ─────────────────────────────────────────────────
  if (typeof class_type_id !== "string" || !class_type_id) {
    return NextResponse.json({ error: "class_type_id is required." }, { status: 400 });
  }
  if (typeof location_id !== "string" || !location_id) {
    return NextResponse.json({ error: "location_id is required." }, { status: 400 });
  }

  // Instructors always create sessions for themselves — they may not supply instructor_id.
  const resolvedInstructorId = isInstructor
    ? profile.id
    : typeof instructor_id === "string" && instructor_id
    ? instructor_id
    : null;

  if (!resolvedInstructorId) {
    return NextResponse.json(
      { error: "instructor_id is required for manager and super admin." },
      { status: 400 }
    );
  }

  // ── Validate sessions array ────────────────────────────────────────────────
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return NextResponse.json(
      { error: "At least one session is required." },
      { status: 400 }
    );
  }

  if (sessions.length > 50) {
    return NextResponse.json(
      { error: "Cannot create more than 50 sessions at once." },
      { status: 400 }
    );
  }

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i] as Record<string, unknown>;

    const start = new Date(s.starts_at as string);
    const end = new Date(s.ends_at as string);

    if (
      typeof s.starts_at !== "string" ||
      typeof s.ends_at !== "string" ||
      isNaN(start.getTime()) ||
      isNaN(end.getTime()) ||
      end <= start
    ) {
      return NextResponse.json(
        { error: `Session ${i + 1}: ends_at must be a valid time after starts_at.` },
        { status: 400 }
      );
    }

    if (typeof s.max_capacity !== "number" || s.max_capacity < 1 || !Number.isInteger(s.max_capacity)) {
      return NextResponse.json(
        { error: `Session ${i + 1}: max_capacity must be a positive integer.` },
        { status: 400 }
      );
    }
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

  // ── Verify location exists ─────────────────────────────────────────────────
  const { data: location } = await adminClient
    .from("locations")
    .select("id")
    .eq("id", location_id)
    .single();

  if (!location) {
    return NextResponse.json({ error: "Location not found." }, { status: 400 });
  }

  // ── Verify instructor exists and is active (manager/super admin only) ───────
  if (!isInstructor) {
    const { data: instructor } = await adminClient
      .from("profiles")
      .select("id")
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

  // ── Batch insert — all or nothing ──────────────────────────────────────────
  const rows = (sessions as SessionEntry[]).map((s) => ({
    class_type_id,
    instructor_id: resolvedInstructorId,
    location_id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    max_capacity: s.max_capacity,
    // Omit notes entirely rather than storing an empty string.
    ...(typeof s.notes === "string" && s.notes.trim() ? { notes: s.notes.trim() } : {}),
  }));

  const { data: newSessions, error: insertError } = await adminClient
    .from("class_sessions")
    .insert(rows)
    .select("id");

  if (insertError || !newSessions) {
    console.error("[POST /api/sessions/bulk] insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create sessions. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { created: newSessions.length, ids: newSessions.map((s) => s.id as string) },
    { status: 201 }
  );
}
