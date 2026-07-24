/**
 * PATCH /api/sessions/[id]/verify-student
 * Called by: SessionDetailClient — manual verified toggle in the student roster
 * Auth: Instructor (own session only), Super Admin
 *
 * Updates the confirmed field on a roster_record.
 * Two modes:
 *   - roster_record_id provided: update that record directly (student went through rollcall)
 *   - booking_id provided: find or create the roster_record for that booking, then update
 *     (handles students who booked online but never used rollcall)
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { NextResponse } from "next/server";

const ALLOWED_ROLES = ["instructor", "super_admin"] as const;

/**
 * Manually sets the confirmed (verified) status on a student's roster_record.
 * @param request - PATCH body: { roster_record_id?: string; booking_id?: string; confirmed: boolean }
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
  let body: { roster_record_id?: string; booking_id?: string; confirmed?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roster_record_id, booking_id, confirmed } = body;

  if (typeof confirmed !== "boolean") {
    return NextResponse.json({ error: "confirmed must be a boolean" }, { status: 400 });
  }

  if (!roster_record_id && !booking_id) {
    return NextResponse.json(
      { error: "roster_record_id or booking_id is required" },
      { status: 400 }
    );
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

  // ── Roster-record path (student went through rollcall) ────────────────────
  if (roster_record_id) {
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

    const { error: updateError } = await admin
      .from("roster_records")
      .update({ confirmed, updated_at: new Date().toISOString() })
      .eq("id", roster_record_id);

    if (updateError) {
      console.error("[verify-student] Update error:", updateError.message);
      return NextResponse.json({ error: "Failed to update verified status." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  // ── Booking path (student booked online, no rollcall record yet) ──────────
  // Find or create a roster_record for this booking so we can set confirmed.
  const { data: booking } = await admin
    .from("bookings")
    .select(
      `id, session_id,
       profiles!bookings_customer_id_fkey ( first_name, last_name, email, phone )`
    )
    .eq("id", booking_id!)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!booking) {
    return NextResponse.json(
      { error: "Booking not found in this session" },
      { status: 404 }
    );
  }

  // Check whether a roster_record already exists for this booking
  const { data: existingRecord } = await admin
    .from("roster_records")
    .select("id")
    .eq("booking_id", booking_id!)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existingRecord) {
    const { error: updateError } = await admin
      .from("roster_records")
      .update({ confirmed, updated_at: new Date().toISOString() })
      .eq("id", existingRecord.id);

    if (updateError) {
      console.error("[verify-student] Update error:", updateError.message);
      return NextResponse.json({ error: "Failed to update verified status." }, { status: 500 });
    }
  } else {
    // Create a minimal roster_record for this booking so confirmed can be tracked.
    // The student's info comes from their booking profile.
    const profile = Array.isArray(booking.profiles)
      ? booking.profiles[0]
      : booking.profiles;

    const { error: insertError } = await admin
      .from("roster_records")
      .insert({
        session_id: sessionId,
        booking_id: booking_id,
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
        confirmed,
      });

    if (insertError) {
      console.error("[verify-student] Insert error:", insertError.message);
      return NextResponse.json({ error: "Failed to create roster record." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
