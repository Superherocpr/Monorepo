/**
 * PATCH /api/settings/instructor-routing/[instructorId]
 * Called by: Admin settings page — Instructor Payment Routing section
 * Auth: super_admin only
 * Updates the payment_routing preference for a single instructor profile.
 * Side effects: profiles row update.
 */

import { createClient } from "@/lib/supabase/server";
import type { PaymentRoutingPreference } from "@/types/payments";

/** The accepted routing values. */
const VALID_ROUTING: PaymentRoutingPreference[] = ["instructor", "business"];

/**
 * Updates one instructor's payment_routing column.
 * @param request - JSON body { payment_routing: 'instructor' | 'business' }
 * @param params - Dynamic route params with the target instructor's UUID.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ instructorId: string }> }
) {
  const { instructorId } = await params;
  const supabase = await createClient();

  // ── Auth: super_admin only ──────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || actor.role !== "super_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Validate input ───────────────────────────────────────────────────────
  const body = await request.json().catch(() => null);
  const routing = (body && typeof body === "object" ? (body as { payment_routing?: unknown }).payment_routing : null) as PaymentRoutingPreference | null;

  if (!routing || !VALID_ROUTING.includes(routing)) {
    return Response.json({ error: "Invalid routing value" }, { status: 400 });
  }

  // ── Verify target is an instructor (super_admin counts too — they may instruct) ──
  const { data: target } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", instructorId)
    .single();

  if (!target || (target.role !== "instructor" && target.role !== "super_admin")) {
    return Response.json(
      { error: "Target profile is not an instructor" },
      { status: 400 }
    );
  }

  // ── Update ──────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("profiles")
    .update({ payment_routing: routing, updated_at: new Date().toISOString() })
    .eq("id", instructorId);

  if (error) {
    console.error("[instructor-routing PATCH] Update failed:", error);
    return Response.json({ error: "Failed to update routing" }, { status: 500 });
  }

  return Response.json({ success: true });
}
