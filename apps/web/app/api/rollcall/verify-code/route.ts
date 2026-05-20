/**
 * POST /api/rollcall/verify-code
 * Called by: /rollcall page — Step 1 (auto-submits on 6-digit entry)
 * Auth: None — public endpoint, IP-rate-limited (THREAT-009)
 * Looks up the instructor whose daily_access_code matches, then returns
 * their approved sessions for today. The code is instructor-specific and
 * regenerates at midnight, making accidental guessing negligible.
 *
 * Rate limit: 10 invalid-or-valid attempts per IP per hour. Blocks brute-
 * force enumeration of the 6-digit code space (1M combinations).
 */

import { createClient } from "@/lib/supabase/server";

interface SessionRow {
  id: string;
  starts_at: string;
  class_types: { name: string } | null;
  locations: { name: string } | null;
}

/** Maximum verify attempts per IP per window. */
const RATE_LIMIT_MAX = 10;
/** Rolling rate-limit window length in ms (1 hour). */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * In-process IP → { count, resetAt } map. Module-level so it survives across
 * requests within the same server instance. Across serverless instances each
 * has its own bucket — acceptable for a brute-force deterrent (effective
 * limit is RATE_LIMIT_MAX × instanceCount).
 */
const attemptBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Records one verify attempt for the given IP and reports whether the
 * caller has exceeded the limit within the rolling window.
 * @returns true when the request is allowed, false when over the limit.
 */
function recordAttempt(ip: string): boolean {
  const now = Date.now();
  const bucket = attemptBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    attemptBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

/**
 * Best-effort client IP extraction.
 * Prefers the first X-Forwarded-For entry (Amplify/Vercel proxy header).
 */
function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

/**
 * Verifies the 6-digit rollcall access code and returns today's sessions
 * for the matching instructor.
 * @param request - POST body: { code: string }
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!recordAttempt(ip)) {
    return Response.json(
      { valid: false, error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

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
