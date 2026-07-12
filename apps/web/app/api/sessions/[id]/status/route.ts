/**
 * PATCH /api/sessions/[id]/status
 * Called by: SessionDetailClient — "Start Class" button
 * Auth: Instructor (own session only), Manager, or Super Admin
 * Updates a session's status field. Currently used to transition
 * scheduled → in_progress. The allowed transitions are validated here
 * to prevent arbitrary status tampering.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { NextResponse } from "next/server";

/** Staff roles permitted to update session status. */
const ALLOWED_ROLES = ["instructor", "manager", "super_admin"] as const;

/**
 * Valid status transitions — only forward movement is allowed via this route.
 * Key = current status, Value = allowed next statuses.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  scheduled: ["in_progress"],
  in_progress: ["completed"],
};

/**
 * Updates the status of a class session.
 * Instructors may only update sessions they own.
 * @param request - PATCH body: { status: "in_progress" | "completed" }
 * @param params - Route params containing the session id
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  // ── Auth (honors view-as; ownership check below uses the effective role) ───
  const authResult = await requireApiRole([...ALLOWED_ROLES]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status: newStatus } = body;
  if (!newStatus) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  // ── Fetch current session ──────────────────────────────────────────────────
  const adminSupabase = await createAdminClient();

  const { data: session } = await adminSupabase
    .from("class_sessions")
    .select("id, status, approval_status, instructor_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // ── Authorization: instructors may only update their own sessions ──────────
  if (actor.effectiveRole === "instructor" && session.instructor_id !== actor.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Validate the session can be transitioned ───────────────────────────────
  if (session.approval_status !== "approved") {
    return NextResponse.json(
      { error: "Only approved sessions can be started." },
      { status: 409 }
    );
  }

  const allowed = ALLOWED_TRANSITIONS[session.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      {
        error: `Cannot transition from "${session.status}" to "${newStatus}".`,
      },
      { status: 409 }
    );
  }

  // ── Apply the update ───────────────────────────────────────────────────────
  const { error: updateError } = await adminSupabase
    .from("class_sessions")
    .update({ status: newStatus })
    .eq("id", sessionId);

  if (updateError) {
    console.error("[session-status] Update error:", updateError.message);
    return NextResponse.json(
      { error: "Failed to update session status." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, status: newStatus });
}
