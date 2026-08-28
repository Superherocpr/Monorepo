/**
 * PATCH /api/sessions/[id]/customer-info
 * Called by: SessionDetailClient — edit-customer-info modal
 * Auth: Instructor (own session only), Super Admin
 *
 * Updates contact info (email, phone, address) on a roster_record — scoped to
 * this session only, never the customer's account-wide profile. This is for
 * Enrollware submission accuracy; the Enrollware export reads directly from
 * roster_records (email/phone with no fallback, address falls back to the
 * linked profile only when blank here), so a roster_record edit is sufficient.
 *
 * Two modes, same find-or-create pattern as verify-student:
 *   - roster_record_id provided: update that record directly
 *   - booking_id provided: find or create the roster_record for that booking
 *     (handles students who booked online but never used rollcall)
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { NextResponse } from "next/server";

const ALLOWED_ROLES = ["instructor", "super_admin"] as const;

interface ContactFields {
  email: string | null;
  phone: string | null;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** Normalizes a possibly-missing string field to trimmed text or null. */
function normalizeField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Updates a student's contact info for this session.
 * @param request - PATCH body: { roster_record_id?: string; booking_id?: string;
 *   email?: string; phone?: string; address_1?: string; address_2?: string;
 *   city?: string; state?: string; zip?: string }
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
  let body: {
    roster_record_id?: string;
    booking_id?: string;
    email?: unknown;
    phone?: unknown;
    address_1?: unknown;
    address_2?: unknown;
    city?: unknown;
    state?: unknown;
    zip?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roster_record_id, booking_id } = body;

  if (!roster_record_id && !booking_id) {
    return NextResponse.json(
      { error: "roster_record_id or booking_id is required" },
      { status: 400 }
    );
  }

  const fields: ContactFields = {
    email: normalizeField(body.email),
    phone: normalizeField(body.phone),
    address_1: normalizeField(body.address_1),
    address_2: normalizeField(body.address_2),
    city: normalizeField(body.city),
    state: normalizeField(body.state),
    zip: normalizeField(body.zip),
  };

  if (!fields.phone) {
    return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
  }

  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
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

  // ── Roster-record path (student already has a roster_record) ──────────────
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
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", roster_record_id);

    if (updateError) {
      console.error("[customer-info] Update error:", updateError.message);
      return NextResponse.json({ error: "Failed to save customer info." }, { status: 500 });
    }

    return NextResponse.json({ success: true, roster_record_id });
  }

  // ── Booking path (student booked online, no rollcall record yet) ──────────
  const { data: booking } = await admin
    .from("bookings")
    .select(
      `id, profiles!bookings_customer_id_fkey ( first_name, last_name )`
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

  const { data: existingRecord } = await admin
    .from("roster_records")
    .select("id")
    .eq("booking_id", booking_id!)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existingRecord) {
    const { error: updateError } = await admin
      .from("roster_records")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", existingRecord.id);

    if (updateError) {
      console.error("[customer-info] Update error:", updateError.message);
      return NextResponse.json({ error: "Failed to save customer info." }, { status: 500 });
    }

    return NextResponse.json({ success: true, roster_record_id: existingRecord.id });
  }

  // Names are required on roster_records — pull from the booking's linked profile
  const profile = Array.isArray(booking.profiles) ? booking.profiles[0] : booking.profiles;

  const { data: created, error: insertError } = await admin
    .from("roster_records")
    .insert({
      session_id: sessionId,
      booking_id: booking_id,
      first_name: profile?.first_name ?? "",
      last_name: profile?.last_name ?? "",
      ...fields,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.error("[customer-info] Insert error:", insertError?.message);
    return NextResponse.json({ error: "Failed to create roster record." }, { status: 500 });
  }

  return NextResponse.json({ success: true, roster_record_id: created.id });
}
