/**
 * GET /api/rollcall/my-code
 * Called by: RollcallDisplayModal — fetches the current code on modal open
 * Auth: Supabase session required — instructor or super_admin role only
 * Returns the authenticated instructor's current daily_access_code and when it
 * was generated, without generating a new one. Clients call
 * POST /api/rollcall/refresh-my-code to regenerate.
 */

import { createClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/**
 * Returns the authenticated instructor's current rollcall code and generation
 * timestamp. Returns null values when no code has been generated yet.
 * @param _request - No body required
 */
export async function GET(_request: Request): Promise<Response> {
  const authResult = await requireApiRole(["instructor", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const user = authResult.actor.user;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("daily_access_code, access_code_generated_at")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    console.error("[my-code] Profile fetch failed:", error?.message);
    return Response.json({ error: "Failed to load code." }, { status: 500 });
  }

  return Response.json({
    code: data.daily_access_code ?? null,
    generatedAt: data.access_code_generated_at ?? null,
  });
}
