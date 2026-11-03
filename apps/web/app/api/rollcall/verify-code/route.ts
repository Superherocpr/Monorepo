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

import { createAdminClient } from "@/lib/supabase/server";
import { businessDate, isSameBusinessDay, classDate, floatingNow } from "@/lib/business-time";
import { TEACHING_ROLES } from "@/lib/auth/view-as-constants";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

interface SessionRow {
  id: string;
  starts_at: string;
  class_types: { name: string } | null;
  locations: { name: string } | null;
}

/**
 * 10 verify attempts per IP per hour. Per-instance buckets (see lib/rate-limit.ts),
 * which is acceptable for a brute-force deterrent.
 */
const allowAttempt = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

/**
 * Verifies the 6-digit rollcall access code and returns today's sessions
 * for the matching instructor.
 * @param request - POST body: { code: string }
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!allowAttempt(ip)) {
    return Response.json(
      { valid: false, error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  const supabase = await createAdminClient();

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
    // managers and super admins teach too, so their codes must verify
    .in("role", TEACHING_ROLES)
    // Deactivated instructors should not be findable
    .eq("deactivated", false)
    .maybeSingle();

  if (!instructor) {
    return Response.json({ valid: false }, { status: 200 });
  }

  // A code is valid for the business day it was generated on. The old 1-hour
  // expiry killed codes mid-class (a BLS class runs 4+ hours) — students
  // arriving late got "code doesn't match". Brute-force is still covered by
  // the IP rate limit plus the 1M-combination code space; the code always
  // dies at midnight Eastern.
  if (!instructor.access_code_generated_at) {
    // No generated_at timestamp means the code was never properly set — reject it
    return Response.json({ valid: false }, { status: 200 });
  }
  if (!isSameBusinessDay(new Date(instructor.access_code_generated_at), new Date())) {
    return Response.json({ valid: false }, { status: 200 });
  }

  // "Today" in the business time zone. starts_at holds a floating wall-clock
  // value, so the ±24h window is centred on the business wall clock rather than
  // the true UTC instant, and the exact match below compares calendar dates.
  const now = new Date();
  const nowFloating = new Date(floatingNow());
  const windowStart = new Date(nowFloating.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(nowFloating.getTime() + 24 * 60 * 60 * 1000);

  const { data: sessions, error: sessionsError } = await supabase
    .from("class_sessions")
    .select("id, starts_at, class_types(name), locations(name)")
    .eq("instructor_id", instructor.id)
    .eq("approval_status", "approved")
    .neq("status", "cancelled")
    .gte("starts_at", windowStart.toISOString())
    .lte("starts_at", windowEnd.toISOString())
    .order("starts_at");

  if (sessionsError) {
    // Surface query failures in logs — an empty list here must never be
    // silently indistinguishable from "instructor has no classes today".
    console.error("[verify-code] Session lookup failed:", sessionsError.message);
  }

  // Nested to-one relations (class_types, locations) are typed as arrays by Supabase
  // typegen, but at runtime they are single objects. Cast through unknown to bridge.
  // classDate reads the class's own calendar day straight off the stored wall
  // clock; businessDate resolves the real instant "now" to a business-day date.
  const today = businessDate(now);
  const sessionRows = ((sessions ?? []) as unknown as SessionRow[]).filter(
    (s) => classDate(s.starts_at) === today
  );

  if (sessionRows.length === 0) {
    // A valid code with zero sessions is an anomaly worth a trace: the
    // instructor generated a code but has nothing approved today. Could be
    // an approval gap, a timezone bug, or an RLS regression — log enough
    // to tell which without exposing anything to the client.
    console.warn(
      `[verify-code] Valid code for instructor ${instructor.id} returned 0 sessions ` +
        `(business date ${today}, raw rows in ±24h window: ${sessions?.length ?? 0})`
    );
  }

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
