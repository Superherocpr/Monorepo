/**
 * POST /api/social/refresh
 * Called by: Admin settings page (manual button) and the daily pg_cron job
 * Auth: super_admin session OR Authorization: Bearer {CRON_SECRET} header
 *
 * Fetches the 12 most recent photo posts from the Facebook page and upserts
 * them into social_feed_cache. Existing posts are updated in place via
 * ON CONFLICT on facebook_post_id, so captions and photo URLs stay current.
 * Also removes legacy seeded rows (facebook_post_id like "FB-%") so the
 * homepage never mixes placeholder data with real Facebook content.
 *
 * Returns:
 *   200 { upserted: number }              — success
 *   401 { error: "Unauthorized" }         — not an admin session and no valid cron secret
 *   500 { error: string }                 — Facebook API error or DB error
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fetchFacebookPhotoPosts } from "@/lib/facebook";

/**
 * Verifies the request comes from either an authenticated super_admin or the
 * scheduled cron service (identified by the CRON_SECRET bearer token).
 * Dual-auth is required because the cron job cannot maintain a user session.
 * @param req - Incoming Next.js request
 * @returns true if the caller is authorized
 */
async function isAuthorized(req: Request): Promise<boolean> {
  // Cron path — checked first to avoid a DB round-trip for scheduled calls
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  // Admin session path
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    return profile?.role === "super_admin";
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const posts = await fetchFacebookPhotoPosts(12);

    if (posts.length === 0) {
      return NextResponse.json({ upserted: 0, message: "No photo posts found on the page" });
    }

    const supabase = await createAdminClient();

    const { error } = await supabase
      .from("social_feed_cache")
      .upsert(
        posts.map((p) => ({
          ...p,
          cached_at: new Date().toISOString(),
        })),
        { onConflict: "facebook_post_id" }
      );

    if (error) {
      console.error("[social/refresh] DB upsert failed:", error.message);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // Remove legacy seeded placeholder rows to avoid broken/non-real post links
    // after the feed has been connected to Facebook.
    const { error: cleanupError } = await supabase
      .from("social_feed_cache")
      .delete()
      .like("facebook_post_id", "FB-%");

    if (cleanupError) {
      console.error("[social/refresh] Seed-row cleanup failed:", cleanupError.message);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ upserted: posts.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[social/refresh] Refresh failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
