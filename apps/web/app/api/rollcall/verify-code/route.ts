/**
 * POST /api/rollcall/verify-code
 * Called by: /rollcall page — Step 1 (auto-submits on 6-digit entry)
 * Auth: None — public endpoint
 * Looks up the instructor whose daily_access_code matches, then returns
 * their approved sessions for today. The code is instructor-specific and
 * regenerates at midnight, making accidental guessing negligible.
 */

import { createClient } from "@/lib/supabase/server";

interface SessionRow {
  id: string;
  starts_at: string;
  class_types: { name: string } | null;
  locations: { name: string } | null;
}

/**
 * Verifies the 6-digit rollcall access code and returns today's sessions
 * for the matching instructor.
 * @param request - POST body: { code: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const body = await request.json();
  const { code } = body as { code: string };

  // Validate code format before querying
  if (!code || !/^\d{6}$/.test(code)) {
    return Response.json({ valid: false }, { status: 200 });
  }

  // Find instructor with this daily_access_code
  const { data: instructor } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, access_code_generated_at")
    .eq("daily_access_code", code)
    // super_admins are also instructors and may teach classes
    .in("role", ["instructor", "super_admin"])
    // Deactivated instructors should not be findable
    .eq("deactivated", false)
    .maybeSingle();

  if (!instructor) {
    return Response.json({ valid: false }, { status: 200 });
  }

  // Reject codes generated on a previous UTC day — stale codes must not remain valid
  if (instructor.access_code_generated_at) {
    const generatedDate = new Date(instructor.access_code_generated_at);
    const todayUTC = new Date();
    const codeIsFromToday =
      generatedDate.getUTCFullYear() === todayUTC.getUTCFullYear() &&
      generatedDate.getUTCMonth() === todayUTC.getUTCMonth() &&
      generatedDate.getUTCDate() === todayUTC.getUTCDate();

    if (!codeIsFromToday) {
      return Response.json({ valid: false }, { status: 200 });
    }
  } else {
    // No generated_at timestamp means the code was never properly set — reject it
    return Response.json({ valid: false }, { status: 200 });
  }

  // "Today" in UTC — sessions starting between midnight and end of today
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id, starts_at, class_types(name), locations(name)")
    .eq("instructor_id", instructor.id)
    .eq("approval_status", "approved")
    .neq("status", "cancelled")
    .gte("starts_at", todayStart.toISOString())
    .lte("starts_at", todayEnd.toISOString())
    .order("starts_at");

  // Nested to-one relations (class_types, locations) are typed as arrays by Supabase
  // typegen, but at runtime they are single objects. Cast through unknown to bridge.
  const sessionRows = (sessions ?? []) as unknown as SessionRow[];

  const formatted = sessionRows.map((s) => ({
    id: s.id,
    startsAt: s.starts_at,
    classTypeName: s.class_types?.name ?? "Class",
    locationName: s.locations?.name ?? "Location TBD",
  }));

  return Response.json({
    valid: true,
    instructorId: instructor.id,
    instructorName: `${instructor.first_name} ${instructor.last_name}`,
    sessions: formatted,
  });
}
