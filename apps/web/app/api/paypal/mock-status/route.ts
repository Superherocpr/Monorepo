/**
 * GET /api/paypal/mock-status
 * Called by: the "Add Student to Class" modal on /admin/sessions/[id], to
 * decide whether to render real PayPal card fields or the staging-only mock
 * charge stub.
 * Auth: instructor, manager, super_admin — mirrors who can open the modal.
 *
 * Deliberately a separate route from /api/paypal/client-token rather than a
 * field added to it: client-token is shared with the public booking page,
 * merch checkout, and team signups, none of which this feature's mock mode
 * is scoped to touch. Changing that route's response shape risks altering
 * behavior for callers that were never asked to change.
 *
 * Not itself a safety boundary — the value here only steers what the client
 * renders. Every route that can actually fabricate a charge (charge-and-book,
 * capture-manual-charge, create-manual-charge-order) independently re-checks
 * isMockPaymentsEnabled() server-side before treating anything as mocked, so
 * a stale or forged response here changes nothing about whether real money
 * moves — see lib/mock-payments.ts.
 */

import { requireApiRole } from "@/lib/auth/effective-role";
import { isMockPaymentsEnabled } from "@/lib/mock-payments";

export async function GET(): Promise<Response> {
  const auth = await requireApiRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  return Response.json({ mock: isMockPaymentsEnabled() });
}
