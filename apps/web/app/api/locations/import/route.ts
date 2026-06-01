/**
 * POST /api/locations/import
 * Called by: LocationImportPanel (admin settings → Locations tab)
 * Auth: manager and super_admin only.
 *
 * Accepts a JSON array of location rows parsed from a CSV upload. Each row
 * must have at least a `name`. Address fields are optional at import time —
 * they default to empty string so records can be filled in after import.
 * The Enrollware ID, abbreviation, and directions (if present) are stored in
 * the `notes` field as a comma-separated metadata line prefixed with
 * "Enrollware:".
 *
 * Returns a summary of how many rows were created, skipped (no name), or
 * failed (DB error per row).
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

/** A single row from the CSV as parsed by the client. */
interface ImportRow {
  /** Enrollware numeric ID — used only to populate notes. */
  enrollware_id?: string;
  /** Location name — required. Rows without a name are skipped. */
  name: string;
  /** Enrollware abbreviation — stored in notes if present. */
  abbreviation?: string;
  /** Directions text — stored in notes if present. */
  directions?: string;
}

/** Shape of the POST body. */
interface ImportBody {
  locations: ImportRow[];
}

/**
 * Builds the `notes` string for a location row from its Enrollware metadata.
 * Returns null when no metadata is available.
 * @param row - The import row.
 */
function buildNotes(row: ImportRow): string | null {
  const parts: string[] = [];

  if (row.enrollware_id?.trim()) {
    parts.push(`Enrollware ID: ${row.enrollware_id.trim()}`);
  }
  if (row.abbreviation?.trim()) {
    parts.push(`Abbrev: ${row.abbreviation.trim()}`);
  }
  if (row.directions?.trim()) {
    parts.push(`Directions: ${row.directions.trim()}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createClient();
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

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as ImportBody).locations)
  ) {
    return NextResponse.json(
      { success: false, error: "Expected { locations: [...] }." },
      { status: 400 }
    );
  }

  const { locations } = body as ImportBody;

  // Hard cap to prevent accidental bulk abuse. 500 is well above any realistic
  // use — the sample CSV has ~50 rows.
  if (locations.length > 500) {
    return NextResponse.json(
      { success: false, error: "Too many rows. Maximum 500 per import." },
      { status: 400 }
    );
  }

  // ── Build rows, skip those without a usable name ──────────────────────────
  const rows: { name: string; address: string; city: string; state: string; zip: string; notes: string | null }[] = [];
  let skipped = 0;

  for (const row of locations) {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) {
      skipped++;
      continue;
    }
    rows.push({
      name,
      // Address fields are intentionally empty at import time.
      // Users can fill them in via the edit flow after import.
      address: "",
      city: "",
      state: "",
      zip: "",
      notes: buildNotes(row),
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({
      success: true,
      created: 0,
      skipped,
      duplicates: 0,
      errors: [],
      message: "No importable rows found — every row was missing a name.",
    });
  }

  // ── Filter out names that already exist in the database ───────────────────
  const admin = await createAdminClient();
  const { data: existingRaw } = await admin
    .from("locations")
    .select("name");
  const existingNames = new Set((existingRaw ?? []).map((r) => r.name as string));

  const newRows: typeof rows = [];
  let duplicates = 0;

  for (const row of rows) {
    if (existingNames.has(row.name)) {
      duplicates++;
    } else {
      // Track within this batch so two rows with the same name don't both insert
      existingNames.add(row.name);
      newRows.push(row);
    }
  }

  if (newRows.length === 0) {
    const parts: string[] = [];
    if (duplicates > 0) parts.push(`${duplicates} skipped (duplicate name)`);
    if (skipped > 0) parts.push(`${skipped} skipped (no name)`);
    return NextResponse.json({
      success: true,
      created: 0,
      skipped,
      duplicates,
      errors: [],
      message: "Nothing was imported — " + parts.join(", ") + ".",
    });
  }

  // ── Bulk insert ─────────────────────────────────────────────────────────────
  // Insert in one shot. Supabase/Postgres will apply NOT NULL constraints but
  // empty string satisfies them for text columns.
  const { data: inserted, error } = await admin
    .from("locations")
    .insert(newRows)
    .select("id");

  if (error) {
    console.error("[POST /api/locations/import]", error.message);
    return NextResponse.json(
      { success: false, error: "Import failed: " + error.message },
      { status: 500 }
    );
  }

  const created = inserted?.length ?? newRows.length;

  const parts: string[] = [`${created} imported`];
  if (duplicates > 0) parts.push(`${duplicates} skipped (duplicate name)`);
  if (skipped > 0) parts.push(`${skipped} skipped (no name)`);

  return NextResponse.json({
    success: true,
    created,
    skipped,
    duplicates,
    errors: [],
    message: parts.join(", ") + ".",
  });
}
