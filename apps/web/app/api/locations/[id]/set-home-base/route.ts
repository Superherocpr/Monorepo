/**
 * PATCH /api/locations/[id]/set-home-base
 * Called by: LocationsClient.tsx ("Set as Home Base" button)
 * Auth: manager and super_admin only
 * Atomically clears is_home_base on all locations, then sets it on the target.
 * This ensures exactly one home base at all times.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sets the target location as the sole home base. */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { id } = await params;

  // ── Auth & access check ────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "manager" && profile.role !== "super_admin")) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Verify target location exists ──────────────────────────────────────────
  const { data: target, error: lookupError } = await supabase
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

  // ── Clear all home bases ───────────────────────────────────────────────────
  const { error: clearError } = await supabase
    .from("locations")
    .update({ is_home_base: false })
    .neq("id", "00000000-0000-0000-0000-000000000000"); // matches all rows

  if (clearError) {
    console.error("[PATCH set-home-base] clear all", clearError);
    return NextResponse.json(
      { success: false, error: "Failed to update home base." },
      { status: 500 }
    );
  }

  // ── Set the target location as home base ───────────────────────────────────
  const { error: setError } = await supabase
    .from("locations")
    .update({ is_home_base: true })
    .eq("id", id);

  if (setError) {
    console.error("[PATCH set-home-base] set target", setError);
    return NextResponse.json(
      { success: false, error: "Failed to set home base." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
