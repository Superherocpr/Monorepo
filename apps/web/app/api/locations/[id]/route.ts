/**
 * PATCH /api/locations/[id]   — update location fields
 * DELETE /api/locations/[id]  — delete location (only if no linked sessions)
 * Called by: LocationsClient.tsx
 * Auth: manager and super_admin only
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/** Valid US state codes for server-side validation. */
const VALID_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

/**
 * Resolves the route param id and verifies manager/super_admin access
 * (honors view-as via requireApiRole).
 * Returns { id } on success or { error: NextResponse } on failure.
 */
async function authAndId(params: Promise<{ id: string }>) {
  const { id } = await params;

  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult;

  return { id };
}

/** Updates editable fields on a location record. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authAndId(params);
  if ("error" in result) return result.error;
  const { id } = result;

  const adminClient = await createAdminClient();

  // ── Input validation ───────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const { name, address, city, state, zip, notes } = body as Record<string, unknown>;

  if (
    typeof name !== "string" || !name.trim() ||
    typeof address !== "string" || !address.trim() ||
    typeof city !== "string" || !city.trim() ||
    typeof state !== "string" || !VALID_STATES.has(state) ||
    typeof zip !== "string" || !zip.trim()
  ) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid required fields." },
      { status: 400 }
    );
  }

  const notesValue = typeof notes === "string" && notes.trim() ? notes.trim() : null;

  // ── Update ─────────────────────────────────────────────────────────────────
  const { error } = await adminClient
    .from("locations")
    .update({
      name: name.trim(),
      address: address.trim(),
      city: city.trim(),
      state,
      zip: zip.trim(),
      notes: notesValue,
    })
    .eq("id", id);

  if (error) {
    console.error("[PATCH /api/locations/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update location." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

/** Deletes a location only if it has no linked class sessions. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authAndId(params);
  if ("error" in result) return result.error;
  const { id } = result;

  const adminClient = await createAdminClient();

  // ── Defensive check — reject if sessions are linked ────────────────────────
  const { count, error: countError } = await adminClient
    .from("class_sessions")
    .select("id", { count: "exact", head: true })
    .eq("location_id", id);

  if (countError) {
    console.error("[DELETE /api/locations/[id]] count check", countError);
    return NextResponse.json(
      { success: false, error: "Failed to verify location usage." },
      { status: 500 }
    );
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `This location is used in ${count} session${count !== 1 ? "s" : ""} and cannot be deleted.`,
      },
      { status: 409 }
    );
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const { error } = await adminClient.from("locations").delete().eq("id", id);

  if (error) {
    console.error("[DELETE /api/locations/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete location." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
