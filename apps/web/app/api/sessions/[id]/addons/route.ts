/**
 * GET /api/sessions/[id]/addons
 * Called by: book/payment page — populates the optional add-ons checklist.
 * Auth: None required — mirrors the public visibility of the booking/schedule
 * pages themselves; returns only active add-ons an instructor enabled for
 * this session (session_addons, migration 0036).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { listSessionAddons } from "@/lib/addon-checkout";

/**
 * Lists the add-ons available for purchase on a given session.
 * @param _request - Unused.
 * @param params - Route params containing the class_sessions UUID.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createAdminClient();
  const addons = await listSessionAddons(supabase, id);
  return Response.json({ addons });
}
