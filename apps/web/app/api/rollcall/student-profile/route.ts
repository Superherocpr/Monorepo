/**
 * POST /api/rollcall/student-profile
 * Called by: /rollcall page — Step 3 (after student taps their name)
 * Auth: None — scoped by sessionId + profileId, both non-guessable UUIDs.
 *       The profileId was obtained from /api/rollcall/session-students, which
 *       is only accessible after providing a valid 6-digit instructor access
 *       code. An active booking is verified before any data is returned.
 * Returns first name, last name, email, phone, and address so the student can
 * confirm or update their contact information before checking in.
 */

// Admin client bypasses RLS — read-only, scoped to sessionId + profileId from a
// validated code. Booking existence is verified before any profile data is returned.
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Returns profile details for a student, gated by an active booking check.
 * @param request - POST body: { profileId: string, sessionId: string }
 */
export async function POST(request: Request) {
  const supabase = await createAdminClient();

  const body = await request.json();
  const { profileId, sessionId } = body as { profileId: string; sessionId: string };

  if (!profileId || !sessionId) {
    return Response.json({ error: "profileId and sessionId required" }, { status: 400 });
  }

  // Verify the student has a non-cancelled booking for this session before
  // returning any personal data — prevents fishing for profile details
  const { data: booking } = await supabase
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("customer_id", profileId)
    .eq("cancelled", false)
    .maybeSingle();

  if (!booking) {
    return Response.json(
      { error: "No active booking found for this student in this session." },
      { status: 403 }
    );
  }

  // Fetch the profile details
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, email, phone, address, city, state, zip")
    .eq("id", profileId)
    .single();

  if (error || !profile) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  return Response.json({
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: profile.email,
    phone: profile.phone ?? null,
    address: profile.address ?? null,
    city: profile.city ?? null,
    state: profile.state ?? null,
    zip: profile.zip ?? null,
  });
}
