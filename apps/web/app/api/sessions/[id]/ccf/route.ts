/**
 * PATCH /api/sessions/[id]/ccf
 * Called by: GradingClient — auto-save on CCF compression score entry
 * Auth: Instructor (own session only), Super Admin
 * Updates the ccf_compression field on a single roster_record belonging to this session.
 * Uses the admin client to bypass RLS (roster_records has no UPDATE RLS policy).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { NextResponse } from "next/server";

const ALLOWED_ROLES = ["instructor", "super_admin"] as const;

/**
 * Saves a CCF compression score for a single roster_record in the given session.
 * Validates session ownership before writing.
 * @param request - PATCH body: { roster_record_id: string; ccf_compression: number }
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
  let body: { roster_record_id?: string; ccf_compression?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roster_record_id, ccf_compression } = body;

  if (!roster_record_id || typeof roster_record_id !== "string") {
    return NextResponse.json({ error: "roster_record_id is required" }, { status: 400 });
  }

  const ccfNum = typeof ccf_compression === "number"
    ? ccf_compression
    : parseInt(String(ccf_compression), 10);

  if (isNaN(ccfNum) || ccfNum < 0) {
    return NextResponse.json(
      { error: "ccf_compression must be a non-negative integer" },
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

  // ── Verify the roster_record belongs to this session ──────────────────────
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

  // ── Save CCF compression score ─────────────────────────────────────────────
  const { error: updateError } = await admin
    .from("roster_records")
    .update({ ccf_compression: ccfNum, updated_at: new Date().toISOString() })
    .eq("id", roster_record_id);

  if (updateError) {
    console.error("[ccf] Update error:", updateError.message);
    return NextResponse.json({ error: "Failed to save CCF compression score." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
