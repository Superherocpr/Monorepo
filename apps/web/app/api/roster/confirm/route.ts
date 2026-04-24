/**
 * PATCH /api/roster/confirm
 * Called by: /roster/[session_token] — student confirm/edit flow
 * Auth: None — device token is the authorization mechanism
 * Updates a roster_record as confirmed (and corrected if fields changed).
 * Also creates and links a booking record if a matching customer account exists.
 * Re-verifies the correction window on every call — enforced server-side.
 */

import { createAdminClient } from "@/lib/supabase/server";

/** The editable fields sent by the student. */
interface UpdateFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  employer: string | null;
}

/**
 * Confirms a student's roster record, optionally applying field updates.
 * Guards: device token must match (if one is set), window must still be open.
 * Side effect: creates a booking record if a customer profile exists for the email.
 * @param request - PATCH body: { recordId, deviceToken, updates: UpdateFields }
 */
export async function PATCH(request: Request) {
  const adminSupabase = await createAdminClient();

  const body = await request.json();
  const { recordId, deviceToken, updates } = body as {
    recordId: string;
    deviceToken: string;
    updates: UpdateFields;
  };

  // ── Input validation ──────────────────────────────────────────────────────
  if (
    !recordId ||
    !deviceToken ||
    !updates?.firstName?.trim() ||
    !updates?.lastName?.trim() ||
    !updates?.email?.trim()
  ) {
    return Response.json(
      { success: false, error: "Missing required fields." },
      { status: 400 }
    );
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(updates.email)) {
    return Response.json(
      { success: false, error: "Invalid email format." },
      { status: 400 }
    );
  }

  // ── 1. Fetch the roster record ────────────────────────────────────────────
  const { data: record } = await adminSupabase
    .from("roster_records")
    .select(
      "id, session_id, booking_id, first_name, last_name, email, phone, employer, device_token, confirmed"
    )
    .eq("id", recordId)
    .single();

  if (!record) {
    return Response.json({ success: false, error: "Record not found." }, { status: 404 });
  }

  // ── 2. Verify device token ────────────────────────────────────────────────
  // If another device has already claimed this record, reject.
  if (record.device_token && record.device_token !== deviceToken) {
    return Response.json({ success: false, error: "Device mismatch." }, { status: 403 });
  }

  // ── 3. Verify correction window still open ────────────────────────────────
  const { data: session } = await adminSupabase
    .from("class_sessions")
    .select("correction_window_closes_at")
    .eq("id", record.session_id)
    .single();

  if (!session?.correction_window_closes_at) {
    return Response.json({ success: false, error: "Session not found." }, { status: 404 });
  }

  if (new Date(session.correction_window_closes_at) < new Date()) {
    return Response.json(
      { success: false, error: "Correction window closed." },
      { status: 403 }
    );
  }

  // ── 4. Detect field changes ───────────────────────────────────────────────
  const normalizedEmail = updates.email.trim().toLowerCase();
  const hasChanges =
    updates.firstName.trim() !== record.first_name ||
    updates.lastName.trim() !== record.last_name ||
    normalizedEmail !== (record.email ?? "") ||
    (updates.phone?.trim() || null) !== (record.phone ?? null) ||
    (updates.employer?.trim() || null) !== (record.employer ?? null);

  // ── 5. Update the roster record ───────────────────────────────────────────
  await adminSupabase
    .from("roster_records")
    .update({
      first_name: updates.firstName.trim(),
      last_name: updates.lastName.trim(),
      email: normalizedEmail,
      phone: updates.phone?.trim() || null,
      employer: updates.employer?.trim() || null,
      confirmed: true,
      corrected: hasChanges,
      // Lock the device token — subsequent attempts from other devices will be rejected
      device_token: deviceToken,
      updated_at: new Date().toISOString(),
    })
    .eq("id", recordId);

  // ── 6. Create or link booking record ─────────────────────────────────────
  // Only proceed if no booking is already linked on this record.
  if (!record.booking_id) {
    const { data: existingProfile } = await adminSupabase
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingProfile) {
      // Guard against duplicate bookings: check if one already exists for this
      // customer + session before inserting (e.g. student already booked online).
      const { data: existingBooking } = await adminSupabase
        .from("bookings")
        .select("id")
        .eq("session_id", record.session_id)
        .eq("customer_id", existingProfile.id)
        .eq("cancelled", false)
        .maybeSingle();

      if (existingBooking) {
        // Link the existing booking instead of creating a new one
        await adminSupabase
          .from("roster_records")
          .update({ booking_id: existingBooking.id })
          .eq("id", recordId);
      } else {
        // Create a new booking linked to this customer's profile
        const { data: newBooking } = await adminSupabase
          .from("bookings")
          .insert({
            session_id: record.session_id,
            customer_id: existingProfile.id,
            // booking_source = invoice because this student came through a group invoice roster
            booking_source: "invoice",
          })
          .select("id")
          .single();

        if (newBooking) {
          await adminSupabase
            .from("roster_records")
            .update({ booking_id: newBooking.id })
            .eq("id", recordId);
        }
      }
    }
    // If no profile exists for this email: booking_id stays null.
    // The record is still confirmed. Grading works regardless.
    // The student can create an account later (via /rollcall or customer portal)
    // and it will be linked at that point.
  }

  return Response.json({ success: true });
}
