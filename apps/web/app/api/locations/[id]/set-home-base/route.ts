/**
 * PATCH /api/locations/[id]/set-home-base
 * Called by: LocationsClient.tsx ("Set as Home Base" / "Remove Home Base" buttons)
 * Auth: manager and super_admin only
 *
 * Toggles is_home_base on the target location only. Multiple locations may be
 * a home base at once — instructors who teach from their own address each mark
 * their address as a home base, and all of them appear as venue options on the
 * public /request-class page.
 *
 * Body: { is_home_base: boolean }
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/** Sets or clears is_home_base on the target location. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth & access check ────────────────────────────────────────────────────
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;

  // ── Input validation ───────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const isHomeBase = (body as Record<string, unknown> | null)?.is_home_base;
  if (typeof isHomeBase !== "boolean") {
    return NextResponse.json(
      { success: false, error: "is_home_base must be a boolean." },
      { status: 400 }
    );
  }

  const adminClient = await createAdminClient();

  // ── Verify target location exists ──────────────────────────────────────────
  const { data: target, error: lookupError } = await adminClient
    .from("locations")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (lookupError || !target) {
    return NextResponse.json(
      { success: false, error: "Location not found." },
      { status: 404 }
    );
  }

  // ── Update the target only — every other location's flag is untouched ─────
  const { error: setError } = await adminClient
    .from("locations")
    .update({ is_home_base: isHomeBase })
    .eq("id", id);

  if (setError) {
    console.error("[PATCH set-home-base]", setError);
    return NextResponse.json(
      { success: false, error: "Failed to update home base." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
