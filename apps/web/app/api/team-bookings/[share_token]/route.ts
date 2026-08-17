/**
 * GET /api/team-bookings/[share_token]
 * Called by: TeamSignupClient (public /team/<token> page) to refresh the
 *   attendee list and seat count without a full reload.
 * Auth: none — the unguessable share token is the entire credential, matching
 *   the /roster/[session_token] model.
 *
 * Returns class details, the employee price, seat availability, and the list of
 * people signed up so far as FIRST + LAST NAME ONLY. The company forwards this
 * link freely, so the response must never carry attendee emails, profile ids,
 * or anything else that could be used to contact or identify someone beyond
 * what a person standing in the room would already see.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getTeamBookingByShareToken } from "@/lib/team-bookings";
import { NextResponse } from "next/server";

/**
 * Handles GET requests for the public team-booking view.
 * @param _request - Incoming request (unused; the token comes from the path).
 * @param context - Route params containing the share token.
 * @returns JSON with `{ data }` on success, or `{ error }` with a status code.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ share_token: string }> }
): Promise<Response> {
  const { share_token: shareToken } = await context.params;

  if (!shareToken) {
    return NextResponse.json({ error: "Missing link token." }, { status: 400 });
  }

  const adminClient = await createAdminClient();
  const view = await getTeamBookingByShareToken(adminClient, shareToken);

  // Same response for a malformed and a non-existent token — nothing here should
  // help someone probe for valid links.
  if (!view) {
    return NextResponse.json({ error: "This signup link is not valid." }, { status: 404 });
  }

  return NextResponse.json({ data: view });
}
