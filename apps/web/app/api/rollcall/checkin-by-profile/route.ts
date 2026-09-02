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
// session exists at this point.
import { createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
// Password verification runs through the shared helper so the anon-key guard and
// the plain-client rationale live in exactly one place.
import { verifyPassword } from "@/lib/auth/verify-password";
import {
  ROLLCALL_VERIFIED_EVENT,
  rollcallChannelTopic,
} from "@/lib/rollcall-realtime";

/** Fields the student may update during check-in. */
interface ProfileUpdates {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Notifies the instructor's session detail page that a student just verified
 * their info, so its Verified column can update without a manual reload.
 * Best-effort — a failed broadcast must never fail the check-in itself; the
 * instructor's page still catches up via its polling fallback.
 * @param supabase - admin client (already connected; reused to send)
 * @param sessionId - session the student checked into
 * @param firstName - student's first name (same exposure level as the public
 *   session-students roster list — no email/phone/address is sent)
 * @param lastName - student's last name
 */
async function broadcastVerified(
  supabase: SupabaseClient,
  sessionId: string,
  firstName: string,
  lastName: string
): Promise<void> {
  try {
    await supabase
      .channel(rollcallChannelTopic(sessionId))
      .httpSend(ROLLCALL_VERIFIED_EVENT, { firstName, lastName });
  } catch (err) {
    console.error("[checkin-by-profile] Broadcast failed:", err);
  }
}

/**
 * Checks in a student by profileId. Optionally updates their profile when
 * password + updates are provided.
 * @param request - POST body: { profileId, sessionId, password?, updates? }
 */
export async function POST(request: Request) {
  const supabase = await createAdminClient();

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
    .select("first_name, last_name, email, phone, address, city, state, zip")
    .eq("id", profileId)
    .single();

  if (!profile) {
    return Response.json({ success: false, error: "Profile not found." }, { status: 500 });
  }

  // ── 4. If updates requested, verify password before applying them ─────────
  // NOTE: this block runs even when the student is already on the roster —
  // password verification must not be bypassed by the idempotency check.
  if (updates) {
    if (!password) {
      return Response.json(
        { success: false, error: "Password is required to update your information." },
        { status: 400 }
      );
    }

    // Validate the submitted update values at the server boundary
    if (!updates.firstName?.trim() || !updates.lastName?.trim() || !updates.phone?.trim()) {
      return Response.json(
        { success: false, error: "First name, last name, and phone number are required." },
        { status: 400 }
      );
    }

    if (!EMAIL_PATTERN.test(updates.email?.trim() ?? "")) {
      return Response.json(
        { success: false, error: "Invalid email address." },
        { status: 400 }
      );
    }

    if (!profile.email) {
      return Response.json(
        {
          success: false,
          error: "Your account is missing an email address. Please see your instructor.",
        },
        { status: 400 }
      );
    }

    // Authenticate using the profile's stored email — this is the identity gate.
    const verified = await verifyPassword(
      profile.email,
      password,
      profileId,
      "checkin-by-profile"
    );

    if (!verified.ok) {
      if (verified.reason === "config") {
        return Response.json(
          { success: false, error: "Server configuration error. Please contact support." },
          { status: 500 }
        );
      }
      return Response.json({ success: false, error: "Incorrect password." }, { status: 401 });
    }

    // Apply the profile updates
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        first_name: updates.firstName.trim(),
        last_name: updates.lastName.trim(),
        email: updates.email.trim().toLowerCase(),
        phone: updates.phone.trim(),
        address: updates.address?.trim() || null,
        city: updates.city?.trim() || null,
        state: updates.state?.trim() || null,
        zip: updates.zip?.trim() || null,
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

    // If the student is already on the roster, skip the insert — the profile
    // update above is the meaningful change. Return alreadyCheckedIn so the
    // page advances to the confirmation screen correctly.
    if (existingRecord) {
      return Response.json({
        success: true,
        alreadyCheckedIn: true,
        firstName: updates.firstName.trim(),
      });
    }

    // Create the roster record using the updated values, marking as corrected
    const { error: rosterError } = await supabase.from("roster_records").insert({
      session_id: sessionId,
      booking_id: booking.id,
      first_name: updates.firstName.trim(),
      last_name: updates.lastName.trim(),
      email: updates.email.trim().toLowerCase(),
      phone: updates.phone.trim(),
      address_1: updates.address?.trim() || null,
      city: updates.city?.trim() || null,
      state: updates.state?.trim() || null,
      zip: updates.zip?.trim() || null,
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

    // Fire-and-forget: a slow or failed broadcast must never delay the check-in
    // response. The instructor's page has a polling fallback for missed events.
    void broadcastVerified(
      supabase,
      sessionId,
      updates.firstName.trim(),
      updates.lastName.trim()
    );

    return Response.json({
      success: true,
      alreadyCheckedIn: false,
      firstName: updates.firstName.trim(),
    });
  }

  // ── 5. No updates path ─────────────────────────────────────────────────────
  // Already on the roster with no changes requested — return immediately.
  if (existingRecord) {
    return Response.json({
      success: true,
      alreadyCheckedIn: true,
      firstName: profile.first_name,
    });
  }

  // ── 6. No updates, not yet checked in — create the roster record ──────────
  const { error: rosterError } = await supabase.from("roster_records").insert({
    session_id: sessionId,
    booking_id: booking.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    phone: profile.phone ?? null,
    address_1: profile.address ?? null,
    city: profile.city ?? null,
    state: profile.state ?? null,
    zip: profile.zip ?? null,
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

  // Fire-and-forget: a slow or failed broadcast must never delay the check-in
  // response. The instructor's page has a polling fallback for missed events.
  void broadcastVerified(supabase, sessionId, profile.first_name, profile.last_name);

  return Response.json({
    success: true,
    alreadyCheckedIn: false,
    firstName: profile.first_name,
  });
}
