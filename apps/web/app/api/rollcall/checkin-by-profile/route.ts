/**
 * POST /api/rollcall/checkin-by-profile
 * Called by: /rollcall page — Step 4 (direct check-in) and Step 4-edit (with updates)
 * Auth: None required for plain check-in — a valid booking proves the student
 *       enrolled. Password verification is required when the student requests
 *       profile updates, preventing anyone else from changing their data.
 * Creates a roster_record for the student in the session. Sets confirmed=true.
 * Sets corrected=true when updates are saved. Idempotent — already-checked-in
 * students are confirmed gracefully without an error.
 */

// supabase (admin) handles all DB reads/writes — bypasses RLS since no user
// session exists at this point. authClient (anon key) is used only for
// signInWithPassword on the edit-with-password path.
import { createClient, createAdminClient } from "@/lib/supabase/server";

/** Fields the student may update during check-in. */
interface ProfileUpdates {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks in a student by profileId. Optionally updates their profile when
 * password + updates are provided.
 * @param request - POST body: { profileId, sessionId, password?, updates? }
 */
export async function POST(request: Request) {
  const supabase = await createAdminClient();
  // User-facing auth client needed only for signInWithPassword — password
  // verification must go through the anon key, not the service role.
  const authClient = await createClient();

  const body = await request.json();
  const { profileId, sessionId, password, updates } = body as {
    profileId: string;
    sessionId: string;
    password?: string;
    updates?: ProfileUpdates;
  };

  if (!profileId || !sessionId) {
    return Response.json(
      { success: false, error: "profileId and sessionId required" },
      { status: 400 }
    );
  }

  // ── 1. Verify the student has an active booking for this session ──────────
  // A non-cancelled booking proves enrollment. Without one, refuse check-in
  // and direct the student to their instructor.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("customer_id", profileId)
    .eq("cancelled", false)
    .maybeSingle();

  if (!booking) {
    return Response.json(
      {
        success: false,
        error: "No booking found for you in this class. Please see your instructor.",
      },
      { status: 403 }
    );
  }

  // ── 2. Check if already checked in (idempotency) ─────────────────────────
  const { data: existingRecord } = await supabase
    .from("roster_records")
    .select("id")
    .eq("booking_id", booking.id)
    .maybeSingle();

  // ── 3. Fetch the current profile ─────────────────────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email, phone")
    .eq("id", profileId)
    .single();

  if (!profile) {
    return Response.json({ success: false, error: "Profile not found." }, { status: 500 });
  }

  // Already on the roster — return success without inserting a duplicate
  if (existingRecord) {
    return Response.json({
      success: true,
      alreadyCheckedIn: true,
      firstName: profile.first_name,
    });
  }

  // ── 4. If updates requested, verify password before applying them ─────────
  if (updates) {
    if (!password) {
      return Response.json(
        { success: false, error: "Password is required to update your information." },
        { status: 400 }
      );
    }

    // Validate the submitted update values at the server boundary
    if (!updates.firstName?.trim() || !updates.lastName?.trim()) {
      return Response.json(
        { success: false, error: "First and last name are required." },
        { status: 400 }
      );
    }

    if (!EMAIL_PATTERN.test(updates.email?.trim() ?? "")) {
      return Response.json(
        { success: false, error: "Invalid email address." },
        { status: 400 }
      );
    }

    // Authenticate using the profile's stored email — this is the identity gate
    const { error: signInError } = await authClient.auth.signInWithPassword({
      email: profile.email,
      password,
    });

    if (signInError) {
      return Response.json({ success: false, error: "Incorrect password." }, { status: 401 });
    }

    // Apply the profile updates
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        first_name: updates.firstName.trim(),
        last_name: updates.lastName.trim(),
        email: updates.email.trim().toLowerCase(),
        phone: updates.phone?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profileId);

    if (updateError) {
      console.error("[checkin-by-profile] Profile update error:", updateError.message);
      return Response.json(
        { success: false, error: "Failed to update your information." },
        { status: 500 }
      );
    }

    // Create the roster record using the updated values, marking as corrected
    const { error: rosterError } = await supabase.from("roster_records").insert({
      session_id: sessionId,
      booking_id: booking.id,
      first_name: updates.firstName.trim(),
      last_name: updates.lastName.trim(),
      email: updates.email.trim().toLowerCase(),
      phone: updates.phone?.trim() || null,
      confirmed: true,
      // corrected=true records that the student made at least one change
      corrected: true,
    });

    if (rosterError) {
      console.error("[checkin-by-profile] Roster insert error:", rosterError.message);
      return Response.json(
        { success: false, error: "Failed to create roster record." },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      alreadyCheckedIn: false,
      firstName: updates.firstName.trim(),
    });
  }

  // ── 5. No updates — create the roster record from the current profile ─────
  const { error: rosterError } = await supabase.from("roster_records").insert({
    session_id: sessionId,
    booking_id: booking.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    phone: profile.phone ?? null,
    confirmed: true,
    corrected: false,
  });

  if (rosterError) {
    console.error("[checkin-by-profile] Roster insert error:", rosterError.message);
    return Response.json(
      { success: false, error: "Failed to create roster record." },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    alreadyCheckedIn: false,
    firstName: profile.first_name,
  });
}
