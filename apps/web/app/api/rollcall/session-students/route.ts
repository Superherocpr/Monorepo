/**
 * POST /api/rollcall/session-students
 * Called by: /rollcall page — Step 3 (student roster picker)
 * Auth: None — sessionId is a non-guessable UUID obtained only after providing
 *       a valid 6-digit instructor access code in the previous step.
 * Returns the list of enrolled (non-cancelled) students for a session, sorted
 * alphabetically by last name then first name. Only names and IDs are returned
 * here — no email or phone is exposed until the student identifies themselves
 * in the next step.
 */

// Admin client bypasses RLS — read-only queries scoped to a sessionId that was
// already validated by the 6-digit code step. No user session exists at this point.
import { createAdminClient } from "@/lib/supabase/server";

/** Shape of each booking row returned from the join query. */
interface BookingRow {
  id: string;
  customer_id: string;
  profiles: {
    first_name: string;
    last_name: string;
  } | null;
}

/**
 * Returns the enrolled student list for a session, sorted alphabetically.
 * @param request - POST body: { sessionId: string }
 */
export async function POST(request: Request) {
  const supabase = await createAdminClient();

  const body = await request.json();
  const { sessionId } = body as { sessionId: string };

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  // Confirm the session exists before returning any data
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  // Fetch all non-cancelled bookings for this session, joining profile names
  const { data: bookings, error } = await supabase
    .from("bookings")
    // The !customer_id hint disambiguates the join — bookings has three FKs to
    // profiles (customer_id, created_by, cancelled_by), so PostgREST needs to
    // know which relationship to follow.
    .select("id, customer_id, profiles!customer_id(first_name, last_name)")
    .eq("session_id", sessionId)
    .eq("cancelled", false);

  if (error) {
    console.error("[session-students] DB error:", error.message);
    return Response.json({ error: "Failed to load students" }, { status: 500 });
  }

  const rows = (bookings ?? []) as unknown as BookingRow[];

  // Build the student list, filtering out any bookings whose profile is missing,
  // then sort alphabetically by last name then first name
  const students = rows
    .filter((b) => b.profiles !== null)
    .map((b) => ({
      profileId: b.customer_id,
      bookingId: b.id,
      firstName: b.profiles!.first_name,
      lastName: b.profiles!.last_name,
    }))
    .sort((a, b) => {
      const lastCmp = a.lastName.localeCompare(b.lastName);
      return lastCmp !== 0 ? lastCmp : a.firstName.localeCompare(b.firstName);
    });

  return Response.json({ students });
}
