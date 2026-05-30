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
// Plain (non-SSR) anon client used only for signInWithPassword. The SSR cookie
// client is unreliable for credential-only checks inside Route Handlers because
// its session-management machinery can swallow auth errors.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Fields the student may update during check-in. */
interface ProfileUpdates {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Extracts the JWT role claim from a Supabase API key when it is in JWT format.
 * Returns null for non-JWT keys (for example, newer publishable key formats).
 * @param key - Supabase API key string
 */
function getJwtRoleClaim(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      role?: string;
    };
    return payload.role ?? null;
  } catch {
    return null;
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

    if (!profile.email) {
      return Response.json(
        {
          success: false,
          error: "Your account is missing an email address. Please see your instructor.",
        },
        { status: 400 }
      );
    }

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!anonKey || !supabaseUrl) {
      console.error("[checkin-by-profile] Missing Supabase env vars for password verification.");
      return Response.json(
        { success: false, error: "Server configuration error. Please contact support." },
        { status: 500 }
      );
    }

    const keyRole = getJwtRoleClaim(anonKey);
    if (keyRole && keyRole !== "anon") {
      console.error(
        `[checkin-by-profile] Refusing password verification because NEXT_PUBLIC_SUPABASE_ANON_KEY role is '${keyRole}', expected 'anon'.`
      );
      return Response.json(
        { success: false, error: "Server configuration error. Please contact support." },
        { status: 500 }
      );
    }

    // Authenticate using the profile's stored email — this is the identity gate.
    // A fresh plain Supabase client (not the SSR cookie client) is used here so
    // that signInWithPassword returns a clean error on bad credentials.
    const anonClient = createSupabaseClient(supabaseUrl, anonKey);
    const { data: authData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: profile.email,
      password,
    });

    // Require both: no auth error and an authenticated user whose ID exactly
    // matches the profile being edited.
    if (signInError || !authData.user || authData.user.id !== profileId) {
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
      phone: updates.phone?.trim() || null,
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

  return Response.json({
    success: true,
    alreadyCheckedIn: false,
    firstName: profile.first_name,
  });
}
