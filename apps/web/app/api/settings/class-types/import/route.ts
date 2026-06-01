/**
 * POST /api/settings/class-types/import
 * Called by: Admin Settings — Class Types import panel
 * Auth: super_admin only
 * Bulk-creates class_types records from an Enrollware CSV/XLSX export.
 *
 * Expected body: { classTypes: ImportClassTypeRow[] }
 * where ImportClassTypeRow = { name, description?, price?, duration_minutes?, max_capacity? }
 *
 * Returns: { success, created, skipped, duplicates, errors, message }
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/** Shape of a single row sent from the import panel. */
interface ImportClassTypeRow {
  name: string;
  description?: string;
  /** Dollar amount as a number ($ prefix already stripped by client). */
  price?: number;
  /** Defaults to 60 if omitted — user edits after import. */
  duration_minutes?: number;
  /** Defaults to 20 if omitted — user edits after import. */
  max_capacity?: number;
}

/** Hard cap on rows per import to prevent runaway inserts. */
const MAX_ROWS = 500;

/**
 * Handles the POST request to bulk-import class types.
 * Skips rows with no name. Reports duplicates separately from hard errors.
 * @param request - POST body: { classTypes: ImportClassTypeRow[] }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role as UserRole) !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const adminClient = await createAdminClient();

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { classTypes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.classTypes)) {
    return Response.json(
      { success: false, error: "classTypes must be an array." },
      { status: 400 }
    );
  }

  const rows = body.classTypes as ImportClassTypeRow[];

  if (rows.length > MAX_ROWS) {
    return Response.json(
      { success: false, error: `Maximum ${MAX_ROWS} rows per import.` },
      { status: 400 }
    );
  }

  // ── Load existing names to detect duplicates before inserting ───────────────
  const { data: existingRaw } = await adminClient
    .from("class_types")
    .select("name");
  const existingNames = new Set((existingRaw ?? []).map((r) => r.name as string));

  // ── Process rows ───────────────────────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const name = (row.name ?? "").trim();

    // Skip rows with no name
    if (!name) {
      skipped++;
      continue;
    }

    // Skip rows whose name already exists in the database
    if (existingNames.has(name)) {
      duplicates++;
      continue;
    }

    // Sanitise and apply defaults
    const price =
      typeof row.price === "number" && row.price >= 0 ? row.price : 0;
    const duration_minutes =
      typeof row.duration_minutes === "number" && row.duration_minutes > 0
        ? row.duration_minutes
        : 60; // default: 60 minutes — user edits after import
    const max_capacity =
      typeof row.max_capacity === "number" && row.max_capacity > 0
        ? row.max_capacity
        : 20; // default: 20 seats — user edits after import

    const { error } = await adminClient.from("class_types").insert({
      name,
      description: (row.description ?? "").trim() || null,
      price,
      duration_minutes,
      max_capacity,
      active: true,
    });

    if (error) {
      if (error.code === "23505") {
        // Unique constraint violation — race condition safety net
        duplicates++;
      } else {
        errors.push(`"${name}": ${error.message}`);
      }
    } else {
      // Track so subsequent rows in this batch don't duplicate each other
      existingNames.add(name);
      created++;
    }
  }

  // ── Build response message ─────────────────────────────────────────────────
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} created`);
  if (duplicates > 0) parts.push(`${duplicates} skipped (duplicate name)`);
  if (skipped > 0) parts.push(`${skipped} skipped (no name)`);
  if (errors.length > 0) parts.push(`${errors.length} error${errors.length !== 1 ? "s" : ""}`);

  const message =
    created === 0 && errors.length === 0
      ? "Nothing was imported — all rows were duplicates or had no name."
      : parts.join(", ") + ".";

  return Response.json({
    success: errors.length === 0,
    created,
    skipped,
    duplicates,
    errors,
    message,
  });
}
