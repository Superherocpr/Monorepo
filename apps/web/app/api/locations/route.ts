/**
 * GET  /api/locations?q=   — search locations by name, address, city, state, zip, or notes
 * POST /api/locations       — create a new location
 * Called by: LocationsClient.tsx
 * Auth: manager and super_admin only
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Valid US state codes for server-side validation. */
const VALID_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

/**
 * Shared auth check. Returns { supabase } on success or a NextResponse error.
 */
async function requireManagerAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "manager" && profile.role !== "super_admin")) {
    return {
      error: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }),
    };
  }

  return { supabase };
}

/**
 * Searches locations by name, address, city, state, zip, or notes.
 * Returns all matches sorted by session count desc. Called when the user types
 * in the search box on the locations page (server-side, beyond the initial top 10).
 * @param request - Expects ?q= query string param.
 */
export async function GET(request: Request) {
  const result = await requireManagerAuth();
  if ("error" in result) return result.error;
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) {
    return NextResponse.json({ success: true, locations: [] });
  }

  // ilike-search across all text columns; Supabase parameterises the value safely
  const pattern = `%${q}%`;
  const { data: raw, error } = await supabase
    .from("locations")
    .select(
      `id, name, address, city, state, zip,
       notes, is_home_base, created_at,
       class_sessions ( id )`
    )
    .or(
      `name.ilike.${pattern},address.ilike.${pattern},city.ilike.${pattern},state.ilike.${pattern},zip.ilike.${pattern},notes.ilike.${pattern}`
    );

  if (error) {
    console.error("[GET /api/locations]", error);
    return NextResponse.json(
      { success: false, error: "Search failed." },
      { status: 500 }
    );
  }

  const locations = (raw ?? [])
    .map((loc) => ({
      id: loc.id,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      notes: loc.notes ?? null,
      is_home_base: loc.is_home_base,
      created_at: loc.created_at,
      sessionCount: Array.isArray(loc.class_sessions)
        ? loc.class_sessions.length
        : 0,
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name));

  return NextResponse.json({ success: true, locations });
}

export async function POST(request: Request) {
  const result = await requireManagerAuth();
  if ("error" in result) return result.error;
  const { supabase } = result;

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

  // ── Insert ─────────────────────────────────────────────────────────────────
  const { data: location, error } = await supabase
    .from("locations")
    .insert({
      name: name.trim(),
      address: address.trim(),
      city: city.trim(),
      state,
      zip: zip.trim(),
      notes: notesValue,
    })
    .select("id, name, address, city, state, zip, notes, is_home_base, created_at")
    .single();

  if (error || !location) {
    console.error("[POST /api/locations]", error);
    return NextResponse.json(
      { success: false, error: "Failed to create location." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, location }, { status: 201 });
}
