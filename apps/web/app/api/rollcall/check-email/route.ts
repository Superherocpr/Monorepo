/**
 * POST /api/rollcall/check-email
 * Called by: /rollcall page — Step 3 (email entry)
 * Auth: None — public endpoint
 * Checks whether a profile exists for the given email, and whether
 * that profile has an active booking for the selected session.
 * Used to route to sign-in (4a) vs account creation (4b).
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Checks for an existing account and booking for the given email + session.
 * @param request - POST body: { email: string, sessionId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const body = await request.json();
  const { email, sessionId } = body as { email: string; sessionId: string };

  if (!email || !sessionId) {
    return Response.json({ error: "email and sessionId required" }, { status: 400 });
  }

  // Basic email format guard
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return Response.json({ error: "Invalid email format" }, { status: 400 });
  }

  // Check if a profile exists with this email
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (!profile) {
    // No account — route to registration
    return Response.json({ exists: false, hasBooking: false });
  }

  // Check if they have a non-cancelled booking for this session
  const { data: booking } = await supabase
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("customer_id", profile.id)
    .eq("cancelled", false)
    .maybeSingle();

  return Response.json({
    exists: true,
    firstName: profile.first_name,
    // hasBooking is informational — the checkin route proceeds even if false
    // (e.g. walk-in who paid cash and will be verified by instructor)
    hasBooking: !!booking,
  });
}
