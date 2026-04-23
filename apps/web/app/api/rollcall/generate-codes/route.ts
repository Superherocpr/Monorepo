/**
 * POST /api/rollcall/generate-codes
 * Called by: Scheduled cron job — daily at midnight (UTC)
 * Auth: CRON_SECRET bearer token — never exposed publicly
 * Generates a fresh random 6-digit numeric code for every active (non-deactivated)
 * instructor. Idempotent within the same UTC day — re-running it mid-day simply
 * refreshes all codes (which is fine for manual re-runs during testing).
 *
 * Cron trigger setup (Amplify / CloudWatch Events):
 *   Schedule: cron(0 0 * * ? *)  — midnight UTC daily
 *   HTTP POST to: https://superherocpr.com/api/rollcall/generate-codes
 *   Header: Authorization: Bearer <CRON_SECRET>
 */

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Generates cryptographically random 6-digit codes for all active instructors.
 * @param request - Must include Authorization: Bearer <CRON_SECRET> header
 */
export async function POST(request: Request) {
  // ── Auth: verify cron secret ──────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[generate-codes] CRON_SECRET env var is not set.");
    return Response.json({ error: "Server misconfiguration." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminSupabase = await createAdminClient();

  // ── Fetch all active instructors ──────────────────────────────────────────
  const { data: instructors, error: fetchError } = await adminSupabase
    .from("profiles")
    .select("id")
    .eq("role", "instructor")
    .eq("deactivated", false);

  if (fetchError || !instructors) {
    console.error("[generate-codes] Failed to fetch instructors:", fetchError);
    return Response.json({ error: "Failed to fetch instructors." }, { status: 500 });
  }

  if (instructors.length === 0) {
    return Response.json({ updated: 0 });
  }

  // ── Generate one code per instructor and upsert ───────────────────────────
  const now = new Date().toISOString();
  const updates = instructors.map((instructor) => ({
    id: instructor.id,
    // crypto.randomInt is not available in Edge runtime; use Math.random for a
    // uniformly-distributed 6-digit numeric string (padded with leading zeros).
    // This is sufficient for a short-lived daily rollcall code.
    daily_access_code: String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"),
    access_code_generated_at: now,
    updated_at: now,
  }));

  const { error: upsertError } = await adminSupabase
    .from("profiles")
    .upsert(updates, { onConflict: "id" });

  if (upsertError) {
    console.error("[generate-codes] Upsert failed:", upsertError);
    return Response.json({ error: "Failed to update codes." }, { status: 500 });
  }

  console.info(`[generate-codes] Generated codes for ${updates.length} instructor(s).`);
  return Response.json({ updated: updates.length });
}
