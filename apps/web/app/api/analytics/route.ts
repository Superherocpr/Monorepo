/**
 * GET /api/analytics?start=ISO&end=ISO
 * Called by: AnalyticsClient when the date range filter changes.
 * Auth: super_admin only.
 * Returns the full AnalyticsData payload for the requested range.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
import { fetchAnalyticsData } from "@/app/(admin)/admin/analytics/_components/analyticsData";

/**
 * Validates the caller is a super_admin, then fetches analytics for the given range.
 * @param request - GET request with `start` and `end` query params (ISO strings)
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role as UserRole) !== "super_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse query params ────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const rangeStart = searchParams.get("start");
  const rangeEnd = searchParams.get("end");

  if (!rangeStart || !rangeEnd) {
    return Response.json({ error: "start and end params required" }, { status: 400 });
  }

  // Validate ISO format to prevent injection
  const isoPattern = /^\d{4}-\d{2}-\d{2}T/;
  if (!isoPattern.test(rangeStart) || !isoPattern.test(rangeEnd)) {
    return Response.json({ error: "Invalid date format" }, { status: 400 });
  }

  // Use admin client so aggregation queries aren't blocked by RLS
  const adminSupabase = await createAdminClient();
  const data = await fetchAnalyticsData(adminSupabase, rangeStart, rangeEnd);

  return Response.json(data);
}
