/**
 * PATCH /api/sessions/[id]/additional-hours
 * Called by: SessionDetailClient — additional hours selector buttons
 * Auth: Instructor (own session only), Super Admin
 * Saves the number of extra hours to add on top of the class type's default
 * duration for this specific session. Used for Enrollware reporting.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { NextResponse } from "next/server";

const ALLOWED_ROLES = ["instructor", "super_admin"] as const;

/**
 * Updates additional_hours on the given class session.
 * @param request - PATCH body: { additional_hours: number } — any non-negative integer
 * @param params - Route params containing the session id
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: sessionId } = await params;

  // ── Auth ───────────────────────────────────────────────────────────────────
  const authResult = await requireApiRole([...ALLOWED_ROLES]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { additional_hours?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.additional_hours;
  const hours = typeof raw === "number" ? raw : parseInt(String(raw), 10);

  if (isNaN(hours) || hours < 0 || !Number.isInteger(hours)) {
    return NextResponse.json(
      { error: "additional_hours must be a non-negative integer" },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();

  // ── Verify session exists and instructor owns it ───────────────────────────
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

  // ── Save ───────────────────────────────────────────────────────────────────
  const { error: updateError } = await admin
    .from("class_sessions")
    .update({ additional_hours: hours })
    .eq("id", sessionId);

  if (updateError) {
    console.error("[additional-hours] Update error:", updateError.message);
    return NextResponse.json({ error: "Failed to save additional hours." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
