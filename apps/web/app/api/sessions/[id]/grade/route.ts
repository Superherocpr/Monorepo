/**
 * PATCH /api/sessions/[id]/grade
 * Called by: GradingClient — auto-save on grade selection
 * Auth: Instructor (own session only), Super Admin
 * Updates the grade on a single roster_record that belongs to this session.
 * Uses the admin client to bypass RLS — the client-side Supabase update was
 * silently failing because roster_records has no UPDATE RLS policy.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { NextResponse } from "next/server";

/** Roles that may submit grades. */
const ALLOWED_ROLES = ["instructor", "super_admin"] as const;

/**
 * Saves a grade for a single roster_record that belongs to the given session.
 * Validates ownership before writing.
 * @param request - PATCH body: { roster_record_id: string; grade: number }
 * @param params - Route params containing the session id
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  // ── Auth ───────────────────────────────────────────────────────────────────
  const authResult = await requireApiRole([...ALLOWED_ROLES]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { roster_record_id?: string; grade?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roster_record_id, grade } = body;

  if (!roster_record_id || typeof roster_record_id !== "string") {
    return NextResponse.json({ error: "roster_record_id is required" }, { status: 400 });
  }

  const gradeNum = typeof grade === "number" ? grade : parseInt(String(grade), 10);
  if (isNaN(gradeNum) || gradeNum < 0) {
    return NextResponse.json({ error: "grade must be a non-negative integer" }, { status: 400 });
  }

  const admin = await createAdminClient();

  // ── Verify the session exists and the instructor owns it ───────────────────
  const { data: session } = await admin
    .from("class_sessions")
    .select("id, instructor_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (actor.effectiveRole === "instructor" && session.instructor_id !== actor.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Verify the roster_record belongs to this session ───────────────────────
  // Prevents a grader from updating records in a different session by
  // supplying a roster_record_id that belongs to another session.
  const { data: record } = await admin
    .from("roster_records")
    .select("id")
    .eq("id", roster_record_id)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!record) {
    return NextResponse.json(
      { error: "Roster record not found in this session" },
      { status: 404 }
    );
  }

  // ── Save the grade ─────────────────────────────────────────────────────────
  const { error: updateError } = await admin
    .from("roster_records")
    .update({ grade: gradeNum, updated_at: new Date().toISOString() })
    .eq("id", roster_record_id);

  if (updateError) {
    console.error("[grade] Update error:", updateError.message);
    return NextResponse.json({ error: "Failed to save grade." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
